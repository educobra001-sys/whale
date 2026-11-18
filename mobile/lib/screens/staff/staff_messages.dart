import 'dart:async';

import 'package:flutter/material.dart';

import '../../services/api.dart';
import '../../theme.dart';
import '../../widgets/common.dart';

/// Write one message with {variables}, choose who gets it, review every row, then send by WhatsApp or Telegram.
/// The server does the sending, so the phone can be closed afterwards. Same rules as the website.
class StaffMessages extends StatelessWidget {
  const StaffMessages({super.key});

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Messages'),
          bottom: const TabBar(tabs: [Tab(text: 'Write & send'), Tab(text: 'History')]),
        ),
        body: const TabBarView(children: [_Compose(), _History()]),
      ),
    );
  }
}

// ---------- helpers shared with the website's rules ----------

String renderTemplate(String template, Map<String, dynamic> values) =>
    template.replaceAllMapped(RegExp(r'\{(\w+)\}'), (m) => values.containsKey(m[1]) ? '${values[m[1]] ?? ''}' : m[0]!);

/// Same rules as the server: Egyptian mobiles are 010, 011, 012 or 015 plus 8 digits; a missing 0,
/// +20 / 0020, spaces and Arabic digits are fixed. Returns null when the number is fine, else the reason.
String? phoneProblem(String? phone) {
  var text = phone ?? '';
  text = text.replaceAllMapped(RegExp('[٠-٩]'), (m) => '${m[0]!.codeUnitAt(0) - 0x0660}');
  text = text.replaceAllMapped(RegExp('[۰-۹]'), (m) => '${m[0]!.codeUnitAt(0) - 0x06f0}');
  final digits = text.replaceAll(RegExp(r'\D'), '').replaceFirst(RegExp('^00'), '');
  if (digits.isEmpty) return 'No phone number';
  var local = '';
  if (RegExp(r'^1\d{9}$').hasMatch(digits)) {
    local = '0$digits';
  } else if (RegExp(r'^0\d{10}$').hasMatch(digits)) {
    local = digits;
  } else if (RegExp(r'^20\d{10}$').hasMatch(digits)) {
    local = '0${digits.substring(2)}';
  } else if (RegExp(r'^200\d{10}$').hasMatch(digits)) {
    local = digits.substring(2);
  }
  if (local.isNotEmpty || digits.startsWith('0') || digits.startsWith('20')) {
    if (local.isEmpty) return 'Wrong length: an Egyptian mobile has 11 digits (01xxxxxxxxx), this has ${digits.replaceFirst(RegExp('^20'), '0').length}';
    if (!RegExp(r'^01[0125]\d{8}$').hasMatch(local)) return 'Egyptian mobiles start with 010, 011, 012 or 015';
    return null;
  }
  if (digits.length >= 10 && digits.length <= 15) return null;
  return 'Too short to be a phone number';
}

const _audiences = [
  ('attended', 'Students who attended a session', 'attendance'),
  ('absent', 'Students who missed a session', 'absence'),
  ('all', 'All students (announcement)', 'marketing'),
];
const _recipients = [('parent', 'Parents'), ('student', 'Students'), ('both', 'Parents and students')];
const _statusTone = {'sent': Tone.success, 'delivered': Tone.success, 'read': Tone.success, 'simulated': Tone.info, 'queued': Tone.muted, 'failed': Tone.danger, 'skipped': Tone.muted};

class _Row {
  _Row(this.data)
      : to = '${data['to'] ?? ''}',
        include = true;
  final Map<String, dynamic> data;
  String to;
  String? customBody;
  String? problem;
  bool include;

  Map<String, dynamic> get values => asMap(data['values']);
  String get recipient => '${data['recipient'] ?? 'parent'}';
  bool get telegramOfKind => asMap(data['telegram'])[recipient] == true;
  bool get telegramAny {
    final t = asMap(data['telegram']);
    return t['any'] == true || t['parent'] == true || t['student'] == true;
  }

  String body(String draft) => customBody ?? renderTemplate(draft, values);
}

// ---------- write & send ----------

class _Compose extends StatefulWidget {
  const _Compose();
  @override
  State<_Compose> createState() => _ComposeState();
}

class _ComposeState extends State<_Compose> with AutomaticKeepAliveClientMixin {
  Map<String, dynamic>? _config;
  List<Map<String, dynamic>> _sessions = [];
  Object? _error;
  String _audience = 'attended';
  String? _session;
  String _recipient = 'parent';
  String _channel = '';
  String _grade = '';
  String _center = '';
  final _draft = TextEditingController();
  List<_Row> _rows = [];
  bool _busy = false;
  Map<String, dynamic>? _progress;
  Timer? _poll;

  @override
  bool get wantKeepAlive => true;

  String get _type => _audiences.firstWhere((a) => a.$1 == _audience).$3;
  bool get _needsSession => _audience != 'all';
  bool get _usesPhone => _channel != 'telegram';
  List<_Row> get _selected => _rows.where((row) => row.include).toList();
  List<_Row> get _wrong => _usesPhone ? _rows.where((row) => row.problem != null).toList() : [];

  // wa.me links need the browser to open each chat by hand, so the app offers only server-side channels.
  List<Map<String, dynamic>> get _channels => asList(_config?['channels']).where((c) => c['key'] != 'whatsapp_link').toList();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _poll?.cancel();
    _draft.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([Api.get('/teacher/messages/config'), Api.get('/teacher/messages/sessions')]);
      final config = asMap(results[0]);
      setState(() {
        _config = config;
        _sessions = asList(results[1]);
        _session = _sessions.isNotEmpty ? '${_sessions.first['_id']}' : null;
        final keys = _channels.map((c) => '${c['key']}').toList();
        _channel = keys.contains('whatsapp_web') ? 'whatsapp_web' : (keys.isNotEmpty ? keys.first : '');
        _draft.text = '${asMap(config['templates'])[_type] ?? ''}';
        _error = null;
      });
    } catch (error) {
      setState(() => _error = error);
    }
  }

  void _setAudience(String value) {
    final previous = '${asMap(_config?['templates'])[_type] ?? ''}';
    setState(() {
      _audience = value;
      if (_draft.text.trim().isEmpty || _draft.text == previous) _draft.text = '${asMap(_config?['templates'])[_type] ?? ''}';
      _rows = [];
    });
  }

  void _insertVariable(String key) {
    final token = '{$key}';
    final selection = _draft.selection;
    final text = _draft.text;
    final start = selection.isValid ? selection.start : text.length;
    final end = selection.isValid ? selection.end : text.length;
    _draft.value = TextEditingValue(text: text.replaceRange(start, end, token), selection: TextSelection.collapsed(offset: start + token.length));
    setState(() {});
  }

  Future<void> _prepare() async {
    if (_needsSession && _session == null) return toast(context, 'Choose a session first.', error: true);
    setState(() => _busy = true);
    final data = await attempt(context, () => Api.post('/teacher/messages/preview', {
          'audience': _audience,
          'type': _type,
          if (_needsSession) 'session': _session,
          'recipient': _recipient,
          'template': _draft.text,
          if (_grade.isNotEmpty) 'grade': _grade,
          if (_center.isNotEmpty) 'center': _center,
        }));
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (data == null) return;
      _rows = [
        for (final item in asList(asMap(data)['items']))
          () {
            final row = _Row(item);
            row.problem = phoneProblem(row.to);
            row.include = _usesPhone ? row.problem == null : row.telegramAny;
            return row;
          }(),
      ];
    });
    if (data != null && _rows.isEmpty && mounted) toast(context, 'No student matches these choices.', error: true);
  }

  Future<void> _checkNumbers() async {
    final phones = {for (final row in _rows) row.to.trim()}..removeWhere((p) => p.isEmpty);
    if (phones.isEmpty) return;
    setState(() => _busy = true);
    final result = await attempt(context, () => Api.post('/teacher/messages/check-numbers', {'phones': phones.toList()}));
    if (!mounted) return;
    setState(() => _busy = false);
    if (result == null) return;
    final byPhone = {for (final item in asList(asMap(result)['numbers'])) '${item['phone']}': item};
    var bad = 0;
    setState(() {
      for (final row in _rows) {
        final found = byPhone[row.to.trim()];
        row.problem = found == null ? phoneProblem(row.to) : (found['ok'] == true ? null : '${found['reason']}');
        if (row.problem != null) {
          row.include = false;
          bad++;
        }
      }
    });
    final note = switch ('${asMap(result)['whatsapp']}') {
      'checked' => '',
      'busy' => ' Only the format was checked: the number is busy sending.',
      'not_linked' => ' Only the format was checked: no WhatsApp number is linked.',
      _ => ' Only the format was checked: WhatsApp didn\'t answer.',
    };
    if (mounted) toast(context, bad > 0 ? '$bad number(s) can\'t receive WhatsApp.$note' : 'All numbers look right.$note', error: bad > 0);
  }

  Future<void> _editRow(_Row row) async {
    final phone = TextEditingController(text: row.to);
    final body = TextEditingController(text: row.body(_draft.text));
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('${row.data['name']}'),
        content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            if (_usesPhone) TextField(controller: phone, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Phone')),
            const Gap(10),
            TextField(controller: body, maxLines: 7, decoration: const InputDecoration(labelText: 'Message for this person')),
          ]),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(style: FilledButton.styleFrom(minimumSize: const Size(90, 44)), onPressed: () => Navigator.pop(context, true), child: const Text('Save')),
        ],
      ),
    );
    if (saved != true) return;
    setState(() {
      row.to = phone.text.trim();
      final wasWrong = row.problem != null;
      row.problem = phoneProblem(row.to);
      if (wasWrong && row.problem == null) row.include = true;
      row.customBody = body.text == renderTemplate(_draft.text, row.values) ? null : body.text;
    });
  }

  Future<void> _send() async {
    final chosen = _selected;
    if (chosen.isEmpty) return;
    if (!await confirm(context, 'Send ${chosen.length} message(s) by ${_channels.firstWhere((c) => c['key'] == _channel, orElse: () => {'label': _channel})['label']}?', ok: 'Send')) return;
    if (!mounted) return;
    setState(() => _busy = true);
    final result = await attempt(context, () => Api.post('/teacher/messages/send', {
          'type': _type,
          if (_needsSession) 'session': _session,
          'channel': _channel,
          'items': [for (final row in chosen) {'student': row.data['student'], 'name': row.data['name'], 'to': row.to, 'recipient': row.recipient, 'body': row.body(_draft.text)}],
        }));
    if (!mounted) return;
    setState(() => _busy = false);
    if (result == null) return;
    final data = asMap(result);
    final skipped = (data['skipped'] ?? 0) as num > 0 ? ' ${data['skipped']} with a wrong number were skipped.' : '';
    toast(context, data['simulated'] == true ? '${data['queued']} recorded as simulated (no number linked).$skipped' : '${data['queued']} message(s) on their way.$skipped');
    setState(() => _rows = []);
    if (data['simulated'] != true) _watch('${data['batch']}', (data['queued'] as num).toInt());
  }

  void _watch(String batchId, int total) {
    _poll?.cancel();
    Future<void> tick() async {
      try {
        final data = asMap(await Api.get('/teacher/messages/batches/$batchId'));
        final counts = <String, int>{};
        for (final item in asList(data['items'])) {
          counts['${item['status']}'] = (counts['${item['status']}'] ?? 0) + 1;
        }
        if (!mounted) return;
        setState(() => _progress = {'total': total, 'counts': counts});
        if ((counts['queued'] ?? 0) == 0) _poll?.cancel();
      } catch (_) {/* try again on the next tick */}
    }

    tick();
    _poll = Timer.periodic(const Duration(seconds: 5), (_) => tick());
  }

  Widget _dropdown<T>(String label, T? value, List<(T, String)> options, ValueChanged<T?> onChanged) => DropdownButtonFormField<T>(
        initialValue: value,
        isExpanded: true,
        decoration: InputDecoration(labelText: label),
        items: [for (final (v, text) in options) DropdownMenuItem(value: v, child: Text(text, overflow: TextOverflow.ellipsis))],
        onChanged: onChanged,
      );

  Widget _channelNote() {
    final whatsapp = asMap(_config?['whatsapp']);
    final text = switch (_channel) {
      'whatsapp_web' => whatsapp['linked'] == true
          ? 'Sent by the server from ${whatsapp['own'] == true ? 'your own number' : 'the platform number'}${'${whatsapp['phone'] ?? ''}'.isNotEmpty ? ' +${whatsapp['phone']}' : ''}, one every ${_config?['delaySeconds']} seconds.'
          : 'No WhatsApp number is linked yet. The owner links one from the website.',
      'telegram' => asMap(_config?['telegram'])['ready'] == true ? 'Only people who opened the bot and shared their number receive it.' : 'The Telegram bot isn\'t set up yet.',
      _ => 'Sent straight away in the background.',
    };
    final warn = (_channel == 'whatsapp_web' && whatsapp['linked'] != true) || (_channel == 'telegram' && asMap(_config?['telegram'])['ready'] != true);
    return Text(text, style: TextStyle(color: warn ? AppColors.danger : AppColors.muted, fontSize: 12.5));
  }

  Widget _rowCard(_Row row) {
    final telegram = _channel == 'telegram';
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: () => _editRow(row),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(4, 8, 12, 10),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Checkbox(value: row.include, onChanged: (value) => setState(() => row.include = value ?? false)),
            Expanded(
              child: Opacity(
                opacity: row.include ? 1 : 0.5,
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(child: Text('${row.data['name']}', style: const TextStyle(fontWeight: FontWeight.w800))),
                    Pill(row.recipient == 'student' ? 'Student' : 'Parent', tone: row.recipient == 'student' ? Tone.info : Tone.accent),
                  ]),
                  const SizedBox(height: 4),
                  if (telegram)
                    row.telegramOfKind
                        ? const Pill('Telegram ✓', tone: Tone.success)
                        : row.telegramAny
                            ? Pill('Telegram ✓ (${row.recipient == 'parent' ? "student's" : "parent's"} chat)', tone: Tone.info)
                            : const Pill('No Telegram', tone: Tone.warn)
                  else ...[
                    Text(row.to.isEmpty ? 'No phone' : row.to, style: TextStyle(color: row.problem != null ? AppColors.danger : AppColors.text, fontWeight: FontWeight.w600)),
                    if (row.problem != null) Text(row.problem!, style: const TextStyle(color: AppColors.danger, fontSize: 12.5)),
                  ],
                  const SizedBox(height: 6),
                  Text(row.body(_draft.text), maxLines: 3, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppColors.muted, fontSize: 13)),
                  if (row.customBody != null) const Text('Edited', style: TextStyle(color: AppColors.accentText, fontSize: 12, fontWeight: FontWeight.w700)),
                ]),
              ),
            ),
          ]),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final config = _config;
    if (config == null) {
      if (_error == null) return const WakingSpinner();
      return EmptyState(icon: Icons.cloud_off_outlined, title: 'Could not load messages', text: '$_error', action: OutlinedButton(onPressed: _load, child: const Text('Try again')));
    }
    if (_channels.isEmpty) {
      final access = asMap(config['access']);
      final missing = [
        if (asList(access['plan']).isEmpty) 'the WhatsApp or Telegram section in your plan',
        if (asList(access['switchedOn']).isEmpty) 'a sending channel switched on for your account',
      ];
      return EmptyState(
        icon: Icons.forum_outlined,
        title: 'Messages aren\'t turned on yet',
        text: 'Your account needs ${missing.isEmpty ? 'a channel that matches your plan' : missing.join(' and ')}. Ask EduCobra to add it.',
      );
    }
    final variables = asList(config['variables']);
    final wrong = _wrong;
    final selected = _selected.length;
    return Stack(children: [
      ListView(padding: const EdgeInsets.fromLTRB(16, 12, 16, 110), children: [
        if (_progress != null) ...[_progressCard(), const Gap()],
        SectionCard(
          title: '1 · Who gets it',
          child: Column(children: [
            _dropdown<String>('Students', _audience, [for (final a in _audiences) (a.$1, a.$2)], (v) => _setAudience(v ?? 'all')),
            if (_needsSession) ...[
              const Gap(10),
              _sessions.isEmpty
                  ? const Align(alignment: Alignment.centerLeft, child: Text('No sessions yet.', style: TextStyle(color: AppColors.muted)))
                  : _dropdown<String>('Session', _session, [for (final s in _sessions) ('${s['_id']}', '${s['label']} · ${date(s['date'])}')], (v) => setState(() => (_session = v, _rows = []))),
            ],
            const Gap(10),
            Row(children: [
              Expanded(child: _dropdown<String>('Grade', _grade, [('', 'Every grade'), for (final g in asList(config['grades'])) ('${g['value']}', '${g['label']}')], (v) => setState(() => (_grade = v ?? '', _rows = [])))),
              const SizedBox(width: 10),
              Expanded(child: _dropdown<String>('Center', _center, [('', 'Every center'), for (final c in asList(config['centers'])) ('${c['_id']}', '${c['name']}'), ('none', 'Online / none')], (v) => setState(() => (_center = v ?? '', _rows = [])))),
            ]),
            const Gap(10),
            _dropdown<String>('Send to', _recipient, _recipients, (v) => setState(() => (_recipient = v ?? 'parent', _rows = []))),
            const Gap(10),
            _dropdown<String>('Send by', _channel, [for (final c in _channels) ('${c['key']}', '${c['label']}')], (v) => setState(() {
                  _channel = v ?? _channel;
                  for (final row in _rows) {
                    row.include = _usesPhone ? row.problem == null : row.telegramAny;
                  }
                })),
            const Gap(8),
            Align(alignment: Alignment.centerLeft, child: _channelNote()),
          ]),
        ),
        const Gap(),
        SectionCard(
          title: '2 · The message',
          trailing: Text('${_draft.text.length} letters', style: const TextStyle(color: AppColors.muted, fontSize: 12)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            TextField(controller: _draft, maxLines: 6, minLines: 4, onChanged: (_) => setState(() {}), decoration: const InputDecoration(hintText: 'Hello {student_name}…')),
            const Gap(8),
            const Text('Tap a field to insert it. It\'s filled in for each student.', style: TextStyle(color: AppColors.muted, fontSize: 12.5)),
            const Gap(6),
            Wrap(spacing: 6, runSpacing: 6, children: [
              for (final v in variables) ActionChip(label: Text('${v['label']}', style: const TextStyle(fontSize: 12.5)), visualDensity: VisualDensity.compact, onPressed: () => _insertVariable('${v['key']}')),
            ]),
            const Gap(10),
            Row(children: [
              Expanded(child: FilledButton.icon(onPressed: _busy ? null : _prepare, icon: const Icon(Icons.group_outlined), label: const Text('Prepare the list'))),
              const SizedBox(width: 8),
              IconButton(
                tooltip: 'Save as the $_type template',
                onPressed: _busy ? null : () => attempt(context, () => Api.put('/teacher/messages/templates/$_type', {'body': _draft.text}), success: 'Template saved.').then((ok) {
                      if (ok != null) asMap(_config?['templates'])[_type] = _draft.text;
                    }),
                icon: const Icon(Icons.bookmark_add_outlined),
              ),
            ]),
          ]),
        ),
        if (_rows.isNotEmpty) ...[
          const Gap(),
          Row(children: [
            Expanded(child: Text('$selected of ${_rows.length} selected', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
            TextButton(onPressed: () => setState(() {
              for (final r in _rows) {
                r.include = !_usesPhone || r.problem == null;
              }
            }), child: const Text('All')),
            TextButton(onPressed: () => setState(() {
              for (final r in _rows) {
                r.include = false;
              }
            }), child: const Text('None')),
          ]),
          if (_usesPhone) OutlinedButton.icon(onPressed: _busy ? null : _checkNumbers, icon: const Icon(Icons.fact_check_outlined), label: const Text('Check numbers on WhatsApp')),
          if (wrong.isNotEmpty) ...[
            const Gap(10),
            SectionCard(
              color: AppColors.dangerSoft,
              child: Row(children: [
                Expanded(child: Text('${wrong.length} wrong number(s). They\'re unticked and won\'t be sent. Tap a row to fix it.', style: const TextStyle(color: AppColors.danger))),
                TextButton(onPressed: () => setState(() => _rows.removeWhere((r) => r.problem != null)), child: const Text('Remove')),
              ]),
            ),
          ],
          const Gap(10),
          for (final row in _rows) Padding(padding: const EdgeInsets.only(bottom: 8), child: _rowCard(row)),
        ],
      ]),
      if (_rows.isNotEmpty)
        Positioned(
          left: 16,
          right: 16,
          bottom: 16,
          child: SafeArea(
            child: FilledButton.icon(
              onPressed: _busy || selected == 0 ? null : _send,
              icon: _busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.send),
              label: Text('Send $selected message${selected == 1 ? '' : 's'}'),
            ),
          ),
        ),
    ]);
  }

  Widget _progressCard() {
    final total = (_progress!['total'] as int);
    final counts = Map<String, int>.from(_progress!['counts'] as Map);
    final done = total - (counts['queued'] ?? 0);
    return SectionCard(
      title: done < total ? 'Sending… $done of $total' : 'Finished · $done of $total',
      trailing: IconButton(
        onPressed: () {
          _poll?.cancel();
          setState(() => _progress = null);
        },
        icon: const Icon(Icons.close, size: 18),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        LinearProgressIndicator(value: total == 0 ? 1 : done / total, minHeight: 8, borderRadius: BorderRadius.circular(99)),
        const Gap(8),
        Wrap(spacing: 6, runSpacing: 6, children: [for (final e in counts.entries) Pill('${e.value} ${e.key}', tone: _statusTone[e.key] ?? Tone.muted)]),
        if (done < total) const Padding(padding: EdgeInsets.only(top: 8), child: Text('The server keeps sending if you close the app.', style: TextStyle(color: AppColors.muted, fontSize: 12.5))),
      ]),
    );
  }
}

// ---------- history ----------

class _History extends StatelessWidget {
  const _History();

  @override
  Widget build(BuildContext context) {
    return LoadView(
      load: () => Api.cached('/teacher/messages/batches'),
      builder: (context, raw, reload) {
        final batches = asList(raw);
        if (batches.isEmpty) return const EmptyState(icon: Icons.history, title: 'Nothing sent yet');
        return Column(children: [
          for (final batch in batches)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Card(
                child: ListTile(
                  title: Text('${batch['type']} · ${batch['channelLabel'] ?? batch['channel']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${dateTime(batch['createdAt'])}${'${batch['sessionLabel'] ?? ''}'.isNotEmpty ? ' · ${batch['sessionLabel']}' : ''}'),
                    const SizedBox(height: 4),
                    Wrap(spacing: 4, runSpacing: 4, children: [
                      for (final e in asMap(batch['counts']).entries) Pill('${e.value} ${e.key}', tone: _statusTone[e.key] ?? Tone.muted),
                    ]),
                  ]),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => _BatchScreen(batchId: '${batch['_id']}'))),
                ),
              ),
            ),
        ]);
      },
    );
  }
}

class _BatchScreen extends StatelessWidget {
  const _BatchScreen({required this.batchId});
  final String batchId;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Messages')),
      body: LoadView(
        load: () => Api.cached('/teacher/messages/batches/$batchId'),
        builder: (context, raw, reload) {
          final items = asList(asMap(raw)['items']);
          return Column(children: [
            for (final item in items)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: SectionCard(
                  title: '${item['name']}',
                  trailing: Pill('${item['status']}', tone: _statusTone['${item['status']}'] ?? Tone.muted),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    if ('${item['to'] ?? ''}'.isNotEmpty) Text('${item['to']}', style: const TextStyle(fontWeight: FontWeight.w600)),
                    if (item['error'] != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text('${item['error']}', style: const TextStyle(color: AppColors.danger, fontSize: 13))),
                    const SizedBox(height: 6),
                    Text('${item['body']}', style: const TextStyle(color: AppColors.muted, fontSize: 13)),
                  ]),
                ),
              ),
          ]);
        },
      ),
    );
  }
}
