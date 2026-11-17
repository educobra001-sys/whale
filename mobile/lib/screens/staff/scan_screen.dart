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

/// Camera or typed code → the student's card → check in, record homework, or check at the door.
/// With no connection, codes are checked against the class saved on the phone and check-ins are
/// queued; the server records them at the real scan time when the connection is back.
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
  String? _homework;

  Map<String, dynamic>? _session;
  List<Map<String, dynamic>> _recent = [];
  Map<String, dynamic>? _lookup;
  Map<String, dynamic>? _offlineStudent;
  String? _notFound;
  String? _problem;
  bool _canForce = false;
  bool _busy = false;
  bool _cameraOn = true;
  String _lastCode = '';
  DateTime _lastAt = DateTime(2000);
  final _history = <(String, String, Tone)>[];

  bool get _showingResult => _lookup != null || _offlineStudent != null || _notFound != null;

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
    _camera.dispose();
    super.dispose();
  }

  Future<void> _loadSessions() async {
    try {
      final sessions = asList(await Api.get('/teacher/sessions'));
      final active = sessions.where((s) => s['active'] == true).firstOrNull;
      if (mounted) setState(() => (_session = active, _recent = sessions.where((s) => s['status'] != 'cancelled').take(3).toList()));
      if (widget.account.can('students_view')) {
        final students = await Api.get('/teacher/myStudents');
        await Outbox.saveSnapshot(students as List, active);
      }
    } on ApiError catch (error) {
      if (!error.offline) return;
      final snap = await Outbox.snapshot();
      if (mounted && snap?['session'] != null) setState(() => _session = asMap(snap!['session']));
    }
  }

  Future<void> _startSession(String id) async {
    final result = await attempt(context, () => Api.patch('/teacher/sessions/$id/active', {'active': true}), success: 'Session started.');
    if (result != null) await _loadSessions();
  }

  void _reset() {
    setState(() {
      _lookup = null;
      _offlineStudent = null;
      _notFound = null;
      _problem = null;
      _canForce = false;
      _homework = null;
      _payment.clear();
      _comment.clear();
    });
    _syncCamera();
  }

  void _record(String name, String text, Tone tone) {
    setState(() {
      _history.insert(0, (name, text, tone));
      if (_history.length > 12) _history.removeLast();
    });
  }

  Future<void> _onCode(String raw) async {
    final code = raw.trim();
    if (code.isEmpty || _busy || _showingResult) return;
    if (code == _lastCode && DateTime.now().difference(_lastAt).inMilliseconds < 2500) return;
    _lastCode = code;
    _lastAt = DateTime.now();
    _manual.clear();
    setState(() => _busy = true);
    _camera.stop().catchError((_) {});
    try {
      final data = asMap(await Api.get('/teacher/scan/lookup', {'identifier': code}));
      _feedback(_mode == ScanMode.door ? data['allowed'] == true : asMap(data['student'])['isBlocked'] != true);
      setState(() => _lookup = data);
    } on ApiError catch (error) {
      if (error.offline) {
        final student = await Outbox.findOffline(code);
        _feedback(student != null);
        setState(() => student != null ? _offlineStudent = student : _notFound = 'No connection, and this code is not in the class saved on this phone.');
      } else {
        _feedback(false);
        setState(() => _notFound = error.message);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _feedback(bool ok) {
    HapticFeedback.mediumImpact();
    SystemSound.play(ok ? SystemSoundType.click : SystemSoundType.alert);
  }

  Map<String, dynamic> get _student => _lookup != null ? asMap(_lookup!['student']) : (_offlineStudent ?? {});

  Map<String, dynamic> _checkinBody({bool force = false}) => {
        'identifier': '${_student['userID'] ?? _student['_id']}',
        'payment': num.tryParse(_payment.text.trim()) ?? 0,
        'homeworkStatus': ?_homework,
        if (_comment.text.trim().isNotEmpty) 'comment': _comment.text.trim(),
        if (force) 'force': true,
      };

  Future<void> _checkIn({bool force = false}) async {
    final session = _session;
    if (session == null) return;
    final body = _checkinBody(force: force);
    final name = fullName(_student);
    if (_offlineStudent != null) {
      await Outbox.add(sessionId: '${session['_id']}', body: body, name: name);
      _record(name, 'Saved offline', Tone.warn);
      if (mounted) toast(context, 'No connection — check-in saved and will be sent automatically.');
      _reset();
      return;
    }
    setState(() => _busy = true);
    try {
      final result = asMap(await Api.post('/teacher/sessions/${session['_id']}/attendance', body));
      _feedback(true);
      _record(name, 'Present · balance ${money(result['balance'])}', Tone.success);
      if (result['session'] is Map) _session = asMap(result['session']);
      if (mounted) toast(context, '$name checked in · balance ${money(result['balance'])}');
      _reset();
    } on ApiError catch (error) {
      _feedback(false);
      if (error.offline) {
        await Outbox.add(sessionId: '${session['_id']}', body: body, name: name);
        _record(name, 'Saved offline', Tone.warn);
        if (mounted) toast(context, 'No connection — check-in saved and will be sent automatically.');
        _reset();
      } else {
        setState(() => (_problem = error.message, _canForce = ['INSUFFICIENT_BALANCE', 'BLOCKED'].contains(error.code)));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _saveHomework(String status) async {
    final session = _session;
    if (session == null) return;
    setState(() => _busy = true);
    final name = fullName(_student);
    final done = await attempt(context, () => Api.post('/teacher/sessions/${session['_id']}/homework', {'identifier': '${_student['userID'] ?? _student['_id']}', 'status': status}));
    if (mounted) setState(() => _busy = false);
    if (done != null) {
      _record(name, 'Homework: ${homeworkLabel(status)}', homeworkTone(status));
      _reset();
    }
  }

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
      const Gap(10),
      if (!_showingResult) ...[
        if (_cameraOn)
          ClipRRect(
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
          ),
        const Gap(10),
        Row(children: [
          Expanded(
            child: TextField(
              controller: _manual,
              textInputAction: TextInputAction.search,
              textCapitalization: TextCapitalization.characters,
              onSubmitted: _onCode,
              decoration: const InputDecoration(hintText: 'Student code or phone', prefixIcon: Icon(Icons.keyboard)),
            ),
          ),
          const SizedBox(width: 8),
          IconButton.filled(onPressed: () => _onCode(_manual.text), icon: const Icon(Icons.search)),
          IconButton(
            tooltip: _cameraOn ? 'Turn camera off' : 'Turn camera on',
            onPressed: () {
              setState(() => _cameraOn = !_cameraOn);
              _syncCamera();
            },
            icon: Icon(_cameraOn ? Icons.videocam_off_outlined : Icons.videocam_outlined),
          ),
        ]),
      ] else
        _resultCard(),
      if (_history.isNotEmpty) ...[
        const Gap(16),
        const Text('This shift', style: TextStyle(fontWeight: FontWeight.w800)),
        const Gap(6),
        for (final (name, text, tone) in _history)
          Padding(padding: const EdgeInsets.only(bottom: 6), child: Row(children: [Expanded(child: Text(name)), Pill(text, tone: tone)])),
      ],
    ]);
  }

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
              'Live: Week ${session['week']} · #${session['number']} — ${session['sequence']}\n${session['centerName'] ?? 'Online'} · ${session['presentCount'] ?? 0} present',
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
    final student = _student;
    final lookup = _lookup;
    final offline = _offlineStudent != null;
    final reasons = [for (final reason in (lookup?['reasons'] as List? ?? const [])) '$reason'];
    final attended = lookup?['attended'] == true;
    final price = lookup?['price'] ?? student['pricePerSession'] ?? _session?['price'];
    return SectionCard(
      color: offline ? AppColors.warnSoft : null,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Avatar(fullName(student), size: 52),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(fullName(student), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
              Text('${student['userID'] ?? ''} · ${gradeLabel(student['grade'])}', style: const TextStyle(color: AppColors.muted)),
            ]),
          ),
          IconButton(onPressed: _reset, icon: const Icon(Icons.close)),
        ]),
        const Gap(8),
        if (offline) const Text('Offline — from the class saved on this phone. The balance may be out of date.', style: TextStyle(color: AppColors.warn, fontSize: 13)),
        InfoRow('Balance', money(student['balance']), valueColor: (student['balance'] ?? 0) < (price ?? 0) ? AppColors.danger : AppColors.success),
        if (price != null) InfoRow('Session price', money(price)),
        if ((student['warningsCount'] ?? asList(lookup?['warnings']).length) > 0) InfoRow('Warnings', '${student['warningsCount'] ?? asList(lookup?['warnings']).length}', valueColor: AppColors.warn),
        if ('${student['centerName'] ?? ''}'.isNotEmpty) InfoRow('Center', '${student['centerName']}'),
        if (student['isBlocked'] == true) const Padding(padding: EdgeInsets.only(top: 6), child: Pill('Blocked', tone: Tone.danger)),
        if (attended) const Padding(padding: EdgeInsets.only(top: 6), child: Pill('Already present in this session', tone: Tone.success)),
        for (final order in asList(lookup?['booklets'])) Padding(padding: const EdgeInsets.only(top: 6), child: Pill('Booklet to deliver: ${asMap(order['booklet'])['name']}', tone: Tone.info)),
        const Gap(10),
        if (_mode == ScanMode.door)
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(color: (lookup?['allowed'] ?? !offline) == true ? AppColors.successSoft : AppColors.dangerSoft, borderRadius: BorderRadius.circular(12)),
            child: Column(children: [
              Text((lookup?['allowed'] ?? true) == true ? 'ALLOWED IN' : 'NOT ALLOWED', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: (lookup?['allowed'] ?? true) == true ? AppColors.success : AppColors.danger)),
              for (final reason in reasons) Text(reason, textAlign: TextAlign.center),
            ]),
          ),
        if (_mode == ScanMode.attendance && !attended) ...[
          if (reasons.isNotEmpty) for (final reason in reasons) Text('• $reason', style: const TextStyle(color: AppColors.danger)),
          TextField(controller: _payment, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Cash paid now (EGP)')),
          const Gap(8),
          DropdownButtonFormField<String>(
            initialValue: _homework,
            decoration: const InputDecoration(labelText: 'Homework (optional)'),
            items: [for (final status in ['complete', 'incomplete', 'no_steps', 'not_done']) DropdownMenuItem(value: status, child: Text(homeworkLabel(status)))],
            onChanged: (value) => _homework = value,
          ),
          const Gap(8),
          TextField(controller: _comment, decoration: const InputDecoration(labelText: 'Comment (optional)')),
          if (_problem != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_problem!, style: const TextStyle(color: AppColors.danger, fontWeight: FontWeight.w700))),
          const Gap(10),
          if (_session == null)
            const Text('Start a session first.', style: TextStyle(color: AppColors.danger))
          else if (_canForce)
            FilledButton(style: FilledButton.styleFrom(backgroundColor: AppColors.danger, foregroundColor: Colors.white), onPressed: _busy ? null : () => _checkIn(force: true), child: const Text('Check in anyway'))
          else
            FilledButton.icon(onPressed: _busy ? null : _checkIn, icon: const Icon(Icons.check), label: Text(offline ? 'Check in (saved offline)' : 'Check in')),
        ],
        if (_mode == ScanMode.homework) ...[
          if (offline) const Text('Homework needs a connection.', style: TextStyle(color: AppColors.warn)),
          if (!offline && !attended) const Text('Mark the student present first.', style: TextStyle(color: AppColors.danger)),
          if (!offline && attended && _session != null)
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final status in ['complete', 'incomplete', 'no_steps', 'not_done'])
                OutlinedButton(onPressed: _busy ? null : () => _saveHomework(status), child: Text(homeworkLabel(status))),
            ]),
        ],
        const Gap(8),
        TextButton(onPressed: _reset, child: const Text('Scan another')),
      ]),
    );
  }
}
