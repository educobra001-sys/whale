import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../services/account.dart';
import '../../services/api.dart';
import '../../services/outbox.dart';
import '../../theme.dart';
import '../../widgets/common.dart';

enum ScanMode { attendance, homework, door }

extension on ScanMode {
  String get label => switch (this) { ScanMode.attendance => 'Attendance', ScanMode.homework => 'Homework', ScanMode.door => 'Door' };
  String get permission => switch (this) { ScanMode.attendance => 'scan_attendance', ScanMode.homework => 'scan_homework', ScanMode.door => 'door_check' };
}

const _homeworkStatuses = ['complete', 'incomplete', 'no_steps', 'not_done'];

/// Camera, the student's number, part of a phone or a name → the student's card → check in, record homework,
/// add cash, or check at the door. The card shows the student's last sessions with homework, the center,
/// notes, warnings and the follow-up assistant.
/// With no connection everything is checked against the class saved on the phone, and the work is queued and
/// sent automatically, at the real scan time, when the connection is back.
class ScanScreen extends StatefulWidget {
  const ScanScreen({super.key, required this.account, required this.visible});
  final Account account;
  final bool visible;
  @override
  State<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<ScanScreen> {
  late final List<ScanMode> _modes = ScanMode.values.where((mode) => widget.account.can(mode.permission)).toList();
  late ScanMode _mode = _modes.first;
  final _camera = MobileScannerController(formats: const [BarcodeFormat.qrCode], autoStart: false);
  final _manual = TextEditingController();
  final _payment = TextEditingController();
  final _comment = TextEditingController();
  final _extraAmount = TextEditingController();
  final _extraReason = TextEditingController();
  String? _homework;

  Map<String, dynamic>? _session;
  List<Map<String, dynamic>> _recent = [];

  /// The student's card, the same shape online (GET /teacher/scan/lookup) and offline (built from the saved class).
  Map<String, dynamic>? _card;
  String? _notFound;
  String? _problem;
  bool _canForce = false;
  bool _busy = false;
  bool _cameraOn = true;
  String _lastCode = '';
  DateTime _lastAt = DateTime(2000);
  final _history = <(String, String, Tone)>[];
  List<StudentHit> _suggestions = [];
  Timer? _debounce;

  bool get _showingResult => _card != null || _notFound != null;
  bool get _offline => _card?['offline'] == true;
  Map<String, dynamic> get _student => asMap(_card?['student']);

  @override
  void initState() {
    super.initState();
    _loadSessions();
    _syncCamera();
  }

  @override
  void didUpdateWidget(covariant ScanScreen old) {
    super.didUpdateWidget(old);
    if (old.visible != widget.visible) {
      _syncCamera();
      if (widget.visible) _loadSessions();
    }
  }

  void _syncCamera() {
    final want = widget.visible && _cameraOn && !_showingResult;
    (want ? _camera.start() : _camera.stop()).catchError((_) {});
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _camera.dispose();
    super.dispose();
  }

  Future<void> _loadSessions() async {
    try {
      final sessions = asList(await Api.get('/teacher/sessions'));
      final active = sessions.where((s) => s['active'] == true).firstOrNull;
      if (mounted) setState(() => (_session = active, _recent = sessions.where((s) => s['status'] != 'cancelled').take(3).toList()));
      // Keep the offline copy fresh while there is a connection.
      unawaited(Outbox.refreshSnapshot());
      unawaited(Outbox.flush());
    } on ApiError catch (error) {
      if (!error.offline) return;
      final saved = Outbox.snap.value?.activeSession;
      if (mounted && saved != null) setState(() => _session = saved);
    }
  }

  Future<void> _startSession(String id) async {
    final result = await attempt(context, () => Api.patch('/teacher/sessions/$id/active', {'active': true}), success: 'Session started.');
    if (result != null) await _loadSessions();
  }

  void _reset() {
    setState(() {
      _card = null;
      _notFound = null;
      _problem = null;
      _canForce = false;
      _homework = null;
      _payment.clear();
      _comment.clear();
      _extraAmount.clear();
      _extraReason.clear();
    });
    _syncCamera();
  }

  void _record(String name, String text, Tone tone) {
    setState(() {
      _history.insert(0, (name, text, tone));
      if (_history.length > 15) _history.removeLast();
    });
  }

  void _feedback(bool ok) {
    HapticFeedback.mediumImpact();
    SystemSound.play(ok ? SystemSoundType.click : SystemSoundType.alert);
  }

  /// A louder warning: wrong center, blocked, or refused at the door.
  void _alarm() {
    HapticFeedback.heavyImpact();
    Future<void>.delayed(const Duration(milliseconds: 250), HapticFeedback.heavyImpact);
    SystemSound.play(SystemSoundType.alert);
  }

  // ---------- finding the student ----------

  /// Searches the saved class first (works with no internet), then the server.
  Future<SearchResult> _search(String text) async {
    final local = Outbox.snap.value?.search(text);
    if (local != null && local.hits.isNotEmpty) return local;
    try {
      final data = asMap(await Api.get('/teacher/scan/search', {'q': text}));
      return SearchResult([for (final row in asList(data['students'])) StudentHit.fromJson(row)], exactCode: data['exactCode'] as String?, total: (data['total'] as num?)?.toInt());
    } on ApiError {
      return local ?? SearchResult(const []);
    }
  }

  /// Typed text → one student's code: an exact code or a single match goes straight on; several open a list.
  Future<String?> _resolve(String text) async {
    final result = await _search(text);
    if (result.exactCode != null) return result.exactCode;
    if (result.hits.isEmpty) return text;
    if (result.hits.length == 1) return result.hits.first.code;
    if (!mounted) return null;
    return showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheet) => SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.of(sheet).size.height * 0.8),
          child: ListView(shrinkWrap: true, padding: const EdgeInsets.fromLTRB(16, 0, 16, 16), children: [
            Text('${result.total} students match "$text"', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            Text(result.total > result.hits.length ? 'Showing the first ${result.hits.length}. Type more to narrow the list.' : 'Tap the student you want.', style: const TextStyle(color: AppColors.muted)),
            const Gap(8),
            for (final hit in result.hits) _HitTile(hit: hit, query: text, onTap: () => Navigator.pop(sheet, hit.code)),
          ]),
        ),
      ),
    );
  }

  void _onTyping(String text) {
    _debounce?.cancel();
    if (text.trim().length < 2) {
      setState(() => _suggestions = []);
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 300), () async {
      final result = await _search(text);
      if (mounted && _manual.text == text) setState(() => _suggestions = result.hits.take(5).toList());
    });
  }

  Future<void> _onTyped(String text) async {
    if (text.trim().isEmpty || _busy) return;
    setState(() => _suggestions = []);
    final code = await _resolve(text.trim());
    if (code != null) await _onCode(code);
  }

  Future<void> _onCode(String raw) async {
    final code = raw.trim();
    if (code.isEmpty || _busy || _showingResult) return;
    if (code == _lastCode && DateTime.now().difference(_lastAt).inMilliseconds < 2500) return;
    _lastCode = code;
    _lastAt = DateTime.now();
    _manual.clear();
    setState(() => (_busy = true, _suggestions = []));
    _camera.stop().catchError((_) {});
    try {
      final data = asMap(await Api.get('/teacher/scan/lookup', {'identifier': code}));
      _show(data);
    } on ApiError catch (error) {
      if (error.offline) {
        final card = _offlineCard(code);
        if (card == null) {
          _feedback(false);
          setState(() => _notFound = Outbox.snap.value == null
              ? 'No connection, and this phone has no saved copy of the class yet. Open Scan once with internet first.'
              : 'No connection, and "$code" isn\'t in the class saved on this phone.');
        } else {
          _show(card);
        }
      } else {
        _feedback(false);
        setState(() => _notFound = error.message);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _show(Map<String, dynamic> card) {
    final student = asMap(card['student']);
    final bad = card['centerMatch'] == false || student['isBlocked'] == true || (_mode == ScanMode.door && card['allowed'] != true);
    bad ? _alarm() : _feedback(true);
    setState(() => _card = card);
  }

  /// The same card the server's lookup returns, built from the saved class.
  Map<String, dynamic>? _offlineCard(String code) {
    final snap = Outbox.snap.value;
    final student = snap?.student(code);
    if (snap == null || student == null) return null;
    final session = _session == null ? null : (snap.session('${_session!['_id']}') ?? _session);
    final record = session == null ? null : snap.record('${student['_id']}', '${session['_id']}');
    final price = (student['pricePerSession'] as num?) ?? (session?['price'] as num?) ?? 0;
    final balance = (student['balance'] as num?) ?? 0;
    final warnings = (student['warningsCount'] as num?)?.toInt() ?? 0;
    final reasons = [
      if (student['isBlocked'] == true) 'Student is blocked',
      if (record == null && balance < price) 'Balance ${money(balance)} is less than the session price ${money(price)}',
      if (warnings >= 3) '$warnings warnings',
    ];
    return {
      'offline': true,
      'savedAt': snap.at?.toIso8601String(),
      'student': {...student, 'warningsCount': warnings},
      'activeSession': session,
      'centerMatch': session == null || session['center'] == null || student['center'] == null || '${session['center']}' == '${student['center']}',
      'attended': record != null,
      'attendance': record == null ? null : {'payment': record['paid'], 'homeworkStatus': record['homework'], 'by': record['by']},
      'price': price,
      'allowed': reasons.isEmpty,
      'reasons': reasons,
      'lastSessions': snap.history(student, except: session == null ? null : '${session['_id']}'),
      'warnings': const [],
      'booklets': const [],
      'exams': const [],
    };
  }

  // ---------- actions ----------

  String get _identifier => '${_student['userID'] ?? _student['_id']}';

  Future<void> _queue(String kind, Map<String, dynamic> body, String note) async {
    final session = _session;
    if (session == null) return;
    final name = fullName(_student);
    await Outbox.add(kind: kind, sessionId: '${session['_id']}', body: body, name: name);
    _record(name, note, Tone.warn);
    if (mounted) toast(context, 'No connection — saved on this phone and sent automatically when the connection is back.');
    _reset();
  }

  Future<void> _checkIn({bool force = false}) async {
    final session = _session;
    if (session == null) return;
    final body = {
      'identifier': _identifier,
      'payment': num.tryParse(_payment.text.trim()) ?? 0,
      'homeworkStatus': ?_homework,
      if (_comment.text.trim().isNotEmpty) 'comment': _comment.text.trim(),
      if (force) 'force': true,
    };
    final name = fullName(_student);
    if (_offline) return _queue('attendance', body, 'Check-in saved offline');
    setState(() => _busy = true);
    try {
      final result = asMap(await Api.post('/teacher/sessions/${session['_id']}/attendance', body));
      _feedback(true);
      _record(name, 'Present · ${money(result['balance'])}', Tone.success);
      if (result['session'] is Map) _session = asMap(result['session']);
      if (mounted) toast(context, '$name checked in · balance ${money(result['balance'])}');
      _reset();
    } on ApiError catch (error) {
      _feedback(false);
      if (error.offline) return _queue('attendance', body, 'Check-in saved offline');
      setState(() => (_problem = error.message, _canForce = ['INSUFFICIENT_BALANCE', 'BLOCKED'].contains(error.code)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Already checked in: more cash on top of what was paid in this session.
  Future<void> _addMoney() async {
    final session = _session;
    final amount = num.tryParse(_extraAmount.text.trim()) ?? 0;
    if (session == null) return;
    if (amount <= 0) return toast(context, 'Enter an amount above zero.', error: true);
    final id = Outbox.newId();
    final body = {'identifier': _identifier, 'amount': amount, if (_extraReason.text.trim().isNotEmpty) 'reason': _extraReason.text.trim()};
    final name = fullName(_student);
    if (_offline) {
      await Outbox.add(kind: 'payment', sessionId: '${session['_id']}', body: body, name: name, id: id);
      _record(name, '+${money(amount)} saved offline', Tone.warn);
      if (mounted) toast(context, 'No connection — the cash is saved and sent automatically.');
      return _reset();
    }
    setState(() => _busy = true);
    try {
      final result = asMap(await Api.post('/teacher/sessions/${session['_id']}/attendance/add-payment', {...body, 'opId': id}));
      _feedback(true);
      _record(name, '+${money(amount)} · ${money(result['balance'])}', Tone.success);
      if (mounted) toast(context, 'Added ${money(amount)} · balance ${money(result['balance'])}');
      _reset();
    } on ApiError catch (error) {
      if (error.offline) {
        await Outbox.add(kind: 'payment', sessionId: '${session['_id']}', body: body, name: name, id: id);
        _record(name, '+${money(amount)} saved offline', Tone.warn);
        _reset();
      } else {
        setState(() => _problem = error.message);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _saveHomework(String status) async {
    final session = _session;
    if (session == null) return;
    final body = {'identifier': _identifier, 'status': status};
    final name = fullName(_student);
    if (_offline) return _queue('homework', body, 'Homework ${homeworkLabel(status)} saved offline');
    setState(() => _busy = true);
    try {
      await Api.post('/teacher/sessions/${session['_id']}/homework', body);
      _feedback(true);
      _record(name, 'Homework: ${homeworkLabel(status)}', homeworkTone(status));
      _reset();
    } on ApiError catch (error) {
      if (error.offline) return _queue('homework', body, 'Homework ${homeworkLabel(status)} saved offline');
      setState(() => _problem = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // ---------- screen ----------

  @override
  Widget build(BuildContext context) {
    return ListView(padding: const EdgeInsets.fromLTRB(16, 4, 16, 32), children: [
      if (_modes.length > 1)
        SegmentedButton<ScanMode>(
          segments: [for (final mode in _modes) ButtonSegment(value: mode, label: Text(mode.label))],
          selected: {_mode},
          onSelectionChanged: (value) {
            setState(() => _mode = value.first);
            _reset();
          },
        ),
      const Gap(10),
      _sessionCard(),
      _snapshotLine(),
      const Gap(10),
      if (!_showingResult) ...[
        if (_cameraOn) _cameraBox(),
        const Gap(10),
        Row(children: [
          Expanded(
            child: TextField(
              controller: _manual,
              textInputAction: TextInputAction.search,
              keyboardType: TextInputType.text,
              onChanged: _onTyping,
              onSubmitted: _onTyped,
              decoration: const InputDecoration(hintText: 'Code, number, phone or name', prefixIcon: Icon(Icons.keyboard)),
            ),
          ),
          const SizedBox(width: 8),
          IconButton.filled(onPressed: _busy ? null : () => _onTyped(_manual.text), icon: const Icon(Icons.search)),
          IconButton(
            tooltip: _cameraOn ? 'Turn camera off' : 'Turn camera on',
            onPressed: () {
              setState(() => _cameraOn = !_cameraOn);
              _syncCamera();
            },
            icon: Icon(_cameraOn ? Icons.videocam_off_outlined : Icons.videocam_outlined),
          ),
        ]),
        const Padding(
          padding: EdgeInsets.only(top: 4, left: 4),
          child: Text('Just the number works: 123 = STU-000123. Part of a phone or a name shows a list.', style: TextStyle(color: AppColors.muted, fontSize: 12)),
        ),
        for (final hit in _suggestions) _HitTile(hit: hit, query: _manual.text, onTap: () => _onCode(hit.code)),
      ] else
        _resultCard(),
      if (_history.isNotEmpty) ...[
        const Gap(16),
        Row(children: [
          const Expanded(child: Text('This shift', style: TextStyle(fontWeight: FontWeight.w800))),
          Text('${_history.length}', style: const TextStyle(color: AppColors.muted)),
        ]),
        const Gap(6),
        for (final (name, text, tone) in _history)
          Padding(padding: const EdgeInsets.only(bottom: 6), child: Row(children: [Expanded(child: Text(name)), Pill(text, tone: tone)])),
      ],
    ]);
  }

  Widget _cameraBox() => ClipRRect(
        borderRadius: BorderRadius.circular(18),
        child: SizedBox(
          height: 240,
          child: Stack(fit: StackFit.expand, children: [
            MobileScanner(
              controller: _camera,
              onDetect: (capture) {
                final value = capture.barcodes.firstOrNull?.rawValue;
                if (value != null) _onCode(value);
              },
              errorBuilder: (context, error) => Container(
                color: Colors.black,
                alignment: Alignment.center,
                padding: const EdgeInsets.all(16),
                child: Text(
                  error.errorCode == MobileScannerErrorCode.permissionDenied ? 'Allow camera access in the phone settings, or type the code below.' : 'The camera is not available — type the code below.',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white70),
                ),
              ),
            ),
            Center(child: Container(width: 170, height: 170, decoration: BoxDecoration(border: Border.all(color: AppColors.accent, width: 3), borderRadius: BorderRadius.circular(18)))),
            if (_busy) const ColoredBox(color: Colors.black45, child: Center(child: CircularProgressIndicator())),
            Positioned(top: 6, right: 6, child: IconButton.filledTonal(icon: const Icon(Icons.flashlight_on_outlined), onPressed: () => _camera.toggleTorch().catchError((_) {}))),
          ]),
        ),
      );

  /// How old the offline copy is, and how much is waiting to be sent.
  Widget _snapshotLine() => ValueListenableBuilder3(
        a: Outbox.snap,
        b: Outbox.items,
        c: Connection.online,
        builder: (context, snap, items, online) {
          final waiting = items.where((i) => i.error == null).length;
          final text = [
            if (!online) 'Offline',
            snap?.at == null ? 'No offline copy yet' : 'Offline copy ${dateTime(snap!.at!.toIso8601String())} · ${snap.students.length} students',
            if (waiting > 0) '$waiting waiting to send',
          ].join(' · ');
          return Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Row(children: [
              Icon(online ? Icons.cloud_done_outlined : Icons.cloud_off, size: 16, color: online ? AppColors.muted : AppColors.warn),
              const SizedBox(width: 6),
              Expanded(child: Text(text, style: TextStyle(color: online ? AppColors.muted : AppColors.warn, fontSize: 12.5))),
              if (online)
                InkWell(
                  onTap: () async {
                    final ok = await Outbox.refreshSnapshot();
                    if (context.mounted) toast(context, ok ? 'Offline copy updated.' : 'Could not update the offline copy.', error: !ok);
                  },
                  child: const Padding(padding: EdgeInsets.all(4), child: Text('Update', style: TextStyle(color: AppColors.accentText, fontWeight: FontWeight.w700, fontSize: 12.5))),
                ),
            ]),
          );
        },
      );

  Widget _sessionCard() {
    final session = _session;
    if (session != null) {
      return SectionCard(
        color: AppColors.successSoft,
        child: Row(children: [
          const Icon(Icons.sensors, color: AppColors.success),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'Live: Week ${session['week']} · #${session['number']} — ${session['sequence']}\n${'${session['centerName'] ?? ''}'.isEmpty ? 'Online' : session['centerName']}${session['presentCount'] != null ? ' · ${session['presentCount']} present' : ''}',
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
          IconButton(onPressed: _loadSessions, icon: const Icon(Icons.refresh)),
        ]),
      );
    }
    if (_mode == ScanMode.door) return const SectionCard(color: AppColors.infoSoft, child: Text('No live session. The door check still shows balance, warnings and block status.'));
    return SectionCard(
      color: AppColors.dangerSoft,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('No live session. Start one to record ${_mode == ScanMode.homework ? 'homework' : 'attendance'}.', style: const TextStyle(fontWeight: FontWeight.w700)),
        if (widget.account.can('sessions_manage'))
          Wrap(spacing: 8, children: [
            for (final s in _recent) ActionChip(label: Text('Start #${s['number']} · ${'${s['sequence']}'.length > 18 ? '${'${s['sequence']}'.substring(0, 18)}…' : s['sequence']}'), onPressed: () => _startSession('${s['_id']}')),
          ])
        else
          const Text('Ask your teacher to start the session.'),
      ]),
    );
  }

  Widget _note(String text, Color bg, Color fg, {IconData? icon}) => Container(
        margin: const EdgeInsets.only(top: 8),
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(10)),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (icon != null) ...[Icon(icon, size: 18, color: fg), const SizedBox(width: 8)],
          Expanded(child: Text(text, style: TextStyle(color: fg, fontWeight: FontWeight.w600))),
        ]),
      );

  /// The student's last sessions: present/absent, where, and the homework mark.
  Widget _historyRow(List<Map<String, dynamic>> rows) {
    if (rows.isEmpty) return const SizedBox.shrink();
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Gap(12),
      const Text('Previous sessions', style: TextStyle(fontWeight: FontWeight.w800)),
      const Gap(6),
      for (final row in rows)
        Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: Row(children: [
            Expanded(
              child: Text(
                'W${asMap(row['session'])['week']} · #${asMap(row['session'])['number']} · ${date(asMap(row['session'])['date'])}${'${row['location'] ?? ''}'.isNotEmpty ? ' · ${row['location']}' : ''}',
                style: const TextStyle(fontSize: 13),
                overflow: TextOverflow.ellipsis,
              ),
            ),
            Pill(switch ('${row['status']}') { 'present' => 'Present', 'absent' => 'Absent', 'cancelled' => 'Cancelled', _ => 'Live' },
                tone: switch ('${row['status']}') { 'present' => Tone.success, 'absent' => Tone.danger, _ => Tone.muted }),
            if (row['status'] == 'present') ...[const SizedBox(width: 4), Pill(homeworkLabel(row['homeworkStatus']), tone: homeworkTone(row['homeworkStatus']))],
          ]),
        ),
    ]);
  }

  Widget _resultCard() {
    if (_notFound != null) {
      return SectionCard(
        color: AppColors.dangerSoft,
        child: Column(children: [
          const Icon(Icons.person_off_outlined, size: 40, color: AppColors.danger),
          const Gap(6),
          Text(_notFound!, textAlign: TextAlign.center),
          const Gap(10),
          OutlinedButton(onPressed: _reset, child: const Text('Scan another')),
        ]),
      );
    }
    final card = _card!;
    final student = _student;
    final reasons = [for (final reason in asList(card['reasons'])) '$reason'];
    final attended = card['attended'] == true;
    final attendance = asMap(card['attendance']);
    final price = card['price'] ?? student['pricePerSession'] ?? _session?['price'];
    final balance = (student['balance'] as num?) ?? 0;
    final warnings = asList(card['warnings']);
    final warningsCount = (student['warningsCount'] as num?)?.toInt() ?? warnings.length;
    final session = asMap(card['activeSession']);
    final sessionCenter = '${session['centerName'] ?? ''}';
    final centerMatch = card['centerMatch'] != false;
    final exams = asList(card['exams']);
    return SectionCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Avatar(fullName(student), size: 52),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(fullName(student), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
              Text('${student['userID'] ?? ''}${'${student['grade'] ?? ''}'.isNotEmpty ? ' · ${gradeLabel(student['grade'])}' : ''}', style: const TextStyle(color: AppColors.muted)),
            ]),
          ),
          IconButton(onPressed: _reset, icon: const Icon(Icons.close)),
        ]),
        if (_offline)
          _note('No connection — from the copy saved ${card['savedAt'] == null ? 'earlier' : dateTime(card['savedAt'])}. The balance may be out of date; the work is sent when the connection is back.',
              AppColors.infoSoft, AppColors.info, icon: Icons.cloud_off),
        if (student['isBlocked'] == true) _note('Blocked by the teacher.', AppColors.dangerSoft, AppColors.danger, icon: Icons.block),
        if (session.isNotEmpty || '${student['centerName'] ?? ''}'.isNotEmpty)
          centerMatch
              ? _note('Center: ${'${student['centerName'] ?? ''}'.isEmpty ? 'none' : student['centerName']}${sessionCenter.isNotEmpty ? ' — matches this session' : ''}', AppColors.successSoft, AppColors.success, icon: Icons.place_outlined)
              : _note('Center: ${student['centerName']} — NOT this session\'s center ($sessionCenter)', AppColors.dangerSoft, AppColors.danger, icon: Icons.wrong_location_outlined),
        if ('${student['adminNote'] ?? ''}'.isNotEmpty) _note('Note: ${student['adminNote']}', AppColors.warnSoft, AppColors.warn, icon: Icons.push_pin_outlined),
        if ('${student['followUpAssistantName'] ?? ''}'.isNotEmpty) _note('Follow-up assistant: ${student['followUpAssistantName']}', AppColors.accentSoft, AppColors.accentText, icon: Icons.support_agent),
        const Gap(8),
        InfoRow('Balance', money(balance), valueColor: balance < ((price as num?) ?? 0) ? AppColors.danger : AppColors.success),
        if (price != null) InfoRow('Session price', money(price)),
        if (warningsCount > 0) InfoRow('Warnings', '$warningsCount', valueColor: AppColors.warn),
        for (final warning in warnings.take(3)) Text('• ${warning['reason'] ?? 'Warning'} — ${date(warning['createdAt'])}', style: const TextStyle(color: AppColors.warn, fontSize: 13)),
        for (final order in asList(card['booklets'])) Padding(padding: const EdgeInsets.only(top: 6), child: Pill('Booklet to deliver: ${asMap(order['booklet'])['name']}', tone: Tone.info)),
        if (exams.isNotEmpty) ...[
          const Gap(10),
          const Text('Exams', style: TextStyle(fontWeight: FontWeight.w800)),
          for (final exam in exams) InfoRow('${exam['name']}', exam['score'] == null ? 'Absent' : '${exam['score']} / ${exam['maxScore']}'),
        ],
        _historyRow([for (final row in asList(card['lastSessions'])) asMap(row)]),
        const Gap(10),
        if (_mode == ScanMode.door) _doorBanner(card, reasons),
        if (_mode == ScanMode.attendance) ...(attended ? _alreadyPresent(attendance) : _checkInForm(reasons)),
        if (_mode == ScanMode.homework) ..._homeworkPart(attended, attendance),
        if (_problem != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_problem!, style: const TextStyle(color: AppColors.danger, fontWeight: FontWeight.w700))),
        const Gap(8),
        TextButton(onPressed: _reset, child: const Text('Scan another')),
      ]),
    );
  }

  Widget _doorBanner(Map<String, dynamic> card, List<String> reasons) {
    final allowed = card['allowed'] == true;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: allowed ? AppColors.successSoft : AppColors.dangerSoft, borderRadius: BorderRadius.circular(12)),
      child: Column(children: [
        Text(allowed ? 'ALLOWED IN' : 'NOT ALLOWED', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: allowed ? AppColors.success : AppColors.danger)),
        for (final reason in reasons) Text(reason, textAlign: TextAlign.center),
        if (card['attended'] == true) const Text('Already checked in to this session.', textAlign: TextAlign.center),
      ]),
    );
  }

  List<Widget> _alreadyPresent(Map<String, dynamic> attendance) => [
        _note('Already checked in to this session${(attendance['payment'] ?? 0) is num && (attendance['payment'] as num) > 0 ? ' · paid ${money(attendance['payment'])}' : ''}${attendance['by'] != null ? ' (${attendance['by']})' : ''}.',
            AppColors.successSoft, AppColors.success, icon: Icons.check_circle_outline),
        const Gap(10),
        const Text('Add money only', style: TextStyle(fontWeight: FontWeight.w800)),
        const Text('Added to the balance and to what was paid in this session.', style: TextStyle(color: AppColors.muted, fontSize: 12.5)),
        const Gap(6),
        Row(children: [
          Expanded(flex: 2, child: TextField(controller: _extraAmount, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Amount (EGP)', isDense: true))),
          const SizedBox(width: 8),
          Expanded(flex: 3, child: TextField(controller: _extraReason, decoration: const InputDecoration(labelText: 'Reason (optional)', isDense: true))),
        ]),
        const Gap(8),
        FilledButton.icon(onPressed: _busy ? null : _addMoney, icon: const Icon(Icons.payments_outlined), label: Text(_offline ? 'Add money (saved offline)' : 'Add money')),
      ];

  List<Widget> _checkInForm(List<String> reasons) => [
        for (final reason in reasons) Text('• $reason', style: const TextStyle(color: AppColors.danger)),
        TextField(controller: _payment, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Cash paid now (EGP)')),
        const Gap(8),
        DropdownButtonFormField<String>(
          initialValue: _homework,
          decoration: const InputDecoration(labelText: 'Homework (optional)'),
          items: [for (final status in _homeworkStatuses) DropdownMenuItem(value: status, child: Text(homeworkLabel(status)))],
          onChanged: (value) => _homework = value,
        ),
        const Gap(8),
        TextField(controller: _comment, decoration: const InputDecoration(labelText: 'Comment (optional)')),
        const Gap(10),
        if (_session == null)
          const Text('Start a session first.', style: TextStyle(color: AppColors.danger))
        else if (_canForce)
          FilledButton(style: FilledButton.styleFrom(backgroundColor: AppColors.danger, foregroundColor: Colors.white), onPressed: _busy ? null : () => _checkIn(force: true), child: const Text('Check in anyway'))
        else
          FilledButton.icon(onPressed: _busy ? null : _checkIn, icon: const Icon(Icons.check), label: Text(_offline ? 'Check in (saved offline)' : 'Check in')),
      ];

  List<Widget> _homeworkPart(bool attended, Map<String, dynamic> attendance) => [
        if (!attended) _note('Not checked in to this session yet. Check the student in first.', AppColors.dangerSoft, AppColors.danger, icon: Icons.info_outline),
        if (attended && attendance['homeworkStatus'] != null) _note('Recorded in this session: ${homeworkLabel(attendance['homeworkStatus'])}', AppColors.infoSoft, AppColors.info),
        if (attended && _session != null) ...[
          const Gap(8),
          GridView.count(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            crossAxisCount: 2,
            childAspectRatio: 2.8,
            mainAxisSpacing: 8,
            crossAxisSpacing: 8,
            children: [
              for (final status in _homeworkStatuses)
                FilledButton(
                  style: FilledButton.styleFrom(
                    minimumSize: Size.zero,
                    backgroundColor: switch (homeworkTone(status)) { Tone.success => AppColors.success, Tone.warn => AppColors.warn, Tone.danger => AppColors.danger, _ => AppColors.muted },
                    foregroundColor: Colors.white,
                  ),
                  onPressed: _busy ? null : () => _saveHomework(status),
                  child: Text(homeworkLabel(status)),
                ),
            ],
          ),
        ],
      ];
}

/// One student in the search list: code, center, phones (the typed digits highlighted), present / blocked.
class _HitTile extends StatelessWidget {
  const _HitTile({required this.hit, required this.query, required this.onTap});
  final StudentHit hit;
  final String query;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final digits = phoneDigits(query);
    Widget phone(IconData icon, String value) {
      final i = digits.length >= 3 ? value.indexOf(digits) : -1;
      return Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon, size: 14, color: AppColors.muted),
        const SizedBox(width: 3),
        Text.rich(TextSpan(style: const TextStyle(fontSize: 12.5, color: AppColors.text), children: i < 0
            ? [TextSpan(text: value)]
            : [
                TextSpan(text: value.substring(0, i)),
                TextSpan(text: value.substring(i, i + digits.length), style: const TextStyle(backgroundColor: AppColors.accentSoft, fontWeight: FontWeight.w800)),
                TextSpan(text: value.substring(i + digits.length)),
              ])),
      ]);
    }

    return Card(
      margin: const EdgeInsets.only(top: 6),
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(10),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text(hit.name, style: const TextStyle(fontWeight: FontWeight.w800))),
              if (hit.match == 1) const Pill('Other center', tone: Tone.muted),
              if (hit.present) const Padding(padding: EdgeInsets.only(left: 4), child: Pill('Present', tone: Tone.success)),
              if (hit.blocked) const Padding(padding: EdgeInsets.only(left: 4), child: Pill('Blocked', tone: Tone.danger)),
            ]),
            Text('${hit.code}${hit.centerName.isNotEmpty ? ' · ${hit.centerName}' : ''}', style: const TextStyle(color: AppColors.muted, fontSize: 12.5)),
            if (hit.phone.isNotEmpty || hit.parentPhone.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 3),
                child: Wrap(spacing: 12, children: [
                  if (hit.phone.isNotEmpty) phone(Icons.smartphone, hit.phone),
                  if (hit.parentPhone.isNotEmpty) phone(Icons.family_restroom, hit.parentPhone),
                ]),
              ),
          ]),
        ),
      ),
    );
  }
}

class ValueListenableBuilder3<A, B, C> extends StatelessWidget {
  const ValueListenableBuilder3({super.key, required this.a, required this.b, required this.c, required this.builder});
  final ValueListenable<A> a;
  final ValueListenable<B> b;
  final ValueListenable<C> c;
  final Widget Function(BuildContext context, A a, B b, C c) builder;
  @override
  Widget build(BuildContext context) => ValueListenableBuilder<A>(
        valueListenable: a,
        builder: (context, va, _) => ValueListenableBuilder<B>(
          valueListenable: b,
          builder: (context, vb, _) => ValueListenableBuilder<C>(valueListenable: c, builder: (context, vc, _) => builder(context, va, vb, vc)),
        ),
      );
}
