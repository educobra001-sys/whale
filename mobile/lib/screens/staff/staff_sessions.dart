import 'package:flutter/material.dart';

import '../../services/account.dart';
import '../../services/api.dart';
import '../../theme.dart';
import '../../widgets/common.dart';

/// Linked centers and schools for the "where" dropdowns.
Future<List<Map<String, dynamic>>> linkedPlaces() async {
  try {
    final links = asList(await Api.get('/teacher/centers'));
    return [for (final link in links) if (link['status'] == 'active') asMap(link['center'])];
  } catch (_) {
    return [];
  }
}

String placeName(Map<String, dynamic> place) => place['kind'] == 'school' ? '${place['name']} (school)' : '${place['name']}';

class SessionsScreen extends StatefulWidget {
  const SessionsScreen({super.key, required this.account});
  final Account account;
  @override
  State<SessionsScreen> createState() => _SessionsScreenState();
}

class _SessionsScreenState extends State<SessionsScreen> {
  int _version = 0;

  @override
  Widget build(BuildContext context) {
    final a = widget.account;
    return Scaffold(
      floatingActionButton: a.can('sessions_manage')
          ? FloatingActionButton.extended(
              backgroundColor: AppColors.accent,
              onPressed: () async {
                final created = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => const NewSessionScreen()));
                if (created == true) setState(() => _version++);
              },
              icon: const Icon(Icons.add),
              label: const Text('New session'),
            )
          : null,
      body: LoadView(
        key: ValueKey(_version),
        load: () => Api.cached('/teacher/sessions'),
        builder: (context, raw, reload) {
          final sessions = asList(raw);
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (a.has('schedule') && a.canAny(['schedule', 'sessions_view']))
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: OutlinedButton.icon(
                  onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ScheduleScreen(account: a))).then((_) => reload()),
                  icon: const Icon(Icons.calendar_view_week),
                  label: const Text('Weekly schedule'),
                ),
              ),
            if (sessions.isEmpty) const EmptyState(icon: Icons.event_note, title: 'No sessions yet'),
            for (final s in sessions)
              Card(
                margin: const EdgeInsets.only(bottom: 8),
                color: s['active'] == true ? AppColors.successSoft : null,
                child: ListTile(
                  title: Text('Week ${s['week']} · #${s['number']} — ${s['sequence']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text('${date(s['date'])}${'${s['centerName'] ?? ''}'.isNotEmpty ? ' · ${s['centerName']}' : ''} · ${s['presentCount'] ?? 0} present'),
                  trailing: s['active'] == true
                      ? const Pill('Live', tone: Tone.success)
                      : (s['status'] == 'cancelled' ? const Pill('Cancelled', tone: Tone.danger) : const Icon(Icons.chevron_right)),
                  onTap: () async {
                    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => SessionDetailScreen(account: a, sessionId: '${s['_id']}')));
                    await reload();
                  },
                ),
              ),
            const SizedBox(height: 70),
          ]);
        },
      ),
    );
  }
}

class NewSessionScreen extends StatefulWidget {
  const NewSessionScreen({super.key});
  @override
  State<NewSessionScreen> createState() => _NewSessionScreenState();
}

class _NewSessionScreenState extends State<NewSessionScreen> {
  final _sequence = TextEditingController(), _week = TextEditingController(text: '1'), _number = TextEditingController(text: '1'), _price = TextEditingController();
  String? _place;
  String _grade = '';
  bool _startNow = true;
  bool _busy = false;
  List<Map<String, dynamic>> _places = [];

  @override
  void initState() {
    super.initState();
    linkedPlaces().then((places) => mounted ? setState(() => _places = places) : null);
    Api.get('/teacher/sessions').then((raw) {
      final latest = asList(raw).firstOrNull;
      if (latest != null && mounted) {
        setState(() {
          _week.text = '${latest['week'] ?? 1}';
          _number.text = '${((latest['number'] as num?) ?? 0) + 1}';
        });
      }
    }).catchError((_) {});
  }

  Future<void> _create() async {
    setState(() => _busy = true);
    final created = await attempt(context, () => Api.post('/teacher/sessions', {
          'sequence': _sequence.text.trim(),
          'week': int.tryParse(_week.text.trim()) ?? 1,
          'number': int.tryParse(_number.text.trim()) ?? 1,
          'center': _place ?? '',
          if (_grade.isNotEmpty) 'grade': _grade,
          if (_price.text.trim().isNotEmpty) 'price': num.tryParse(_price.text.trim()),
        }));
    if (created != null && _startNow && mounted) {
      await attempt(context, () => Api.patch('/teacher/sessions/${asMap(created)['_id']}/active', {'active': true}));
    }
    if (!mounted) return;
    setState(() => _busy = false);
    if (created != null) Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('New session')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        TextField(controller: _sequence, decoration: const InputDecoration(labelText: 'Title (for example: Chapter 2 revision)')),
        const Gap(),
        Row(children: [
          Expanded(child: TextField(controller: _week, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Week'))),
          const SizedBox(width: 10),
          Expanded(child: TextField(controller: _number, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Number'))),
        ]),
        const Gap(),
        DropdownButtonFormField<String>(
          initialValue: _place,
          decoration: const InputDecoration(labelText: 'Where'),
          items: [
            const DropdownMenuItem(value: null, child: Text('Online / no place')),
            for (final place in _places) DropdownMenuItem(value: '${place['_id']}', child: Text(placeName(place))),
          ],
          onChanged: (value) => _place = value,
        ),
        const Gap(),
        DropdownButtonFormField<String>(
          initialValue: _grade,
          decoration: const InputDecoration(labelText: 'Grade'),
          items: [const DropdownMenuItem(value: '', child: Text('All grades')), for (var i = 0; i < grades.length; i++) DropdownMenuItem(value: '$i', child: Text(grades[i]))],
          onChanged: (value) => _grade = value ?? '',
        ),
        const Gap(),
        TextField(controller: _price, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Price (empty = each student\'s own price)')),
        SwitchListTile(contentPadding: EdgeInsets.zero, value: _startNow, onChanged: (value) => setState(() => _startNow = value), title: const Text('Start it now (go live for scanning)')),
        const Gap(),
        FilledButton(onPressed: _busy ? null : _create, child: _busy ? const CircularProgressIndicator() : const Text('Create session')),
      ]),
    );
  }
}

class SessionDetailScreen extends StatefulWidget {
  const SessionDetailScreen({super.key, required this.account, required this.sessionId});
  final Account account;
  final String sessionId;
  @override
  State<SessionDetailScreen> createState() => _SessionDetailScreenState();
}

class _SessionDetailScreenState extends State<SessionDetailScreen> {
  int _version = 0;

  @override
  Widget build(BuildContext context) {
    final a = widget.account;
    return Scaffold(
      appBar: AppBar(title: const Text('Session report')),
      body: LoadView(
        key: ValueKey(_version),
        load: () => Api.cached('/teacher/sessions/${widget.sessionId}'),
        builder: (context, raw, reload) {
          final s = asMap(raw);
          final rows = asList(s['attendance']);
          final live = s['active'] == true;
          final paid = rows.fold<num>(0, (sum, row) => sum + ((row['payment'] as num?) ?? 0));
          final charged = rows.fold<num>(0, (sum, row) => sum + ((row['charged'] as num?) ?? 0));
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            SectionCard(
              color: live ? AppColors.successSoft : null,
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('Week ${s['week']} · #${s['number']} — ${s['sequence']}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                Text('${dateTime(s['date'])}${'${s['centerName'] ?? ''}'.isNotEmpty ? ' · ${s['centerName']}' : ''}', style: const TextStyle(color: AppColors.muted)),
                if (s['status'] == 'cancelled') const Padding(padding: EdgeInsets.only(top: 6), child: Pill('Cancelled — charges refunded', tone: Tone.danger)),
              ]),
            ),
            const Gap(),
            StatGrid(children: [
              StatTile(label: 'Present', value: '${rows.length}', icon: Icons.check_circle_outline),
              StatTile(label: 'Cash collected', value: money(paid), icon: Icons.payments_outlined, accent: true),
              StatTile(label: 'Charged', value: money(charged)),
              StatTile(label: 'Price', value: s['price'] == null ? 'Per student' : money(s['price'])),
            ]),
            if (a.can('sessions_manage') && s['status'] != 'cancelled')
              FilledButton.icon(
                style: FilledButton.styleFrom(backgroundColor: live ? AppColors.ink : AppColors.accent, foregroundColor: live ? Colors.white : AppColors.ink),
                onPressed: () async {
                  final done = await attempt(context, () => Api.patch('/teacher/sessions/${widget.sessionId}/active', {'active': !live}), success: live ? 'Session closed.' : 'Session is live.');
                  if (done != null) setState(() => _version++);
                },
                icon: Icon(live ? Icons.stop_circle_outlined : Icons.play_circle_outline),
                label: Text(live ? 'Close session' : 'Start session (go live)'),
              ),
            const Gap(),
            SectionCard(
              title: 'Attendance (${rows.length})',
              child: Column(children: [
                if (rows.isEmpty) const Text('Nobody checked in yet.', style: TextStyle(color: AppColors.muted)),
                for (final row in rows)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Avatar(fullName(row['student'])),
                    title: Text(fullName(row['student'])),
                    subtitle: Text([
                      '${asMap(row['student'])['userID'] ?? ''}',
                      if ((row['payment'] ?? 0) > 0) 'paid ${money(row['payment'])}',
                      if ('${row['comment'] ?? ''}'.isNotEmpty) '${row['comment']}',
                    ].join(' · ')),
                    trailing: homeworkLabel(row['homeworkStatus']).isEmpty ? null : Pill(homeworkLabel(row['homeworkStatus']), tone: homeworkTone(row['homeworkStatus'])),
                    onLongPress: !a.can('sessions_manage')
                        ? null
                        : () async {
                            if (!await confirm(context, 'Remove ${fullName(row['student'])} from this session? The session price is refunded.', ok: 'Remove', danger: true)) return;
                            if (!context.mounted) return;
                            final done = await attempt(context, () => Api.delete('/teacher/sessions/${widget.sessionId}/attendance/${asMap(row['student'])['_id']}'));
                            if (done != null) setState(() => _version++);
                          },
                  ),
                if (rows.isNotEmpty && a.can('sessions_manage')) const Text('Long-press a student to remove them.', style: TextStyle(color: AppColors.muted, fontSize: 12)),
              ]),
            ),
          ]);
        },
      ),
    );
  }
}

class ScheduleScreen extends StatefulWidget {
  const ScheduleScreen({super.key, required this.account});
  final Account account;
  @override
  State<ScheduleScreen> createState() => _ScheduleScreenState();
}

class _ScheduleScreenState extends State<ScheduleScreen> {
  int _version = 0;

  Future<void> _addSlot() async {
    final places = await linkedPlaces();
    if (!mounted) return;
    final title = TextEditingController(text: 'Group'), time = TextEditingController(text: '17:00');
    var day = DateTime.now().weekday % 7;
    String? place;
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setLocal) => AlertDialog(
          title: const Text('New weekly group'),
          content: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              TextField(controller: title, decoration: const InputDecoration(labelText: 'Name')),
              const Gap(8),
              DropdownButtonFormField<int>(
                initialValue: day,
                decoration: const InputDecoration(labelText: 'Day'),
                items: [for (var i = 0; i < 7; i++) DropdownMenuItem(value: i, child: Text(days[i]))],
                onChanged: (value) => setLocal(() => day = value ?? day),
              ),
              const Gap(8),
              TextField(controller: time, keyboardType: TextInputType.datetime, decoration: const InputDecoration(labelText: 'Start time (HH:MM)')),
              const Gap(8),
              DropdownButtonFormField<String>(
                initialValue: place,
                decoration: const InputDecoration(labelText: 'Where'),
                items: [const DropdownMenuItem(value: null, child: Text('Online / no place')), for (final p in places) DropdownMenuItem(value: '${p['_id']}', child: Text(placeName(p)))],
                onChanged: (value) => setLocal(() => place = value),
              ),
            ]),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
            TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Add')),
          ],
        ),
      ),
    );
    if (ok != true || !mounted) return;
    final done = await attempt(context, () => Api.post('/teacher/schedule', {'title': title.text.trim(), 'dayOfWeek': day, 'startTime': time.text.trim(), 'center': place ?? ''}), success: 'Group added.');
    if (done != null) setState(() => _version++);
  }

  @override
  Widget build(BuildContext context) {
    final a = widget.account;
    return Scaffold(
      appBar: AppBar(title: const Text('Weekly schedule')),
      floatingActionButton: a.can('schedule') ? FloatingActionButton(backgroundColor: AppColors.accent, onPressed: _addSlot, child: const Icon(Icons.add)) : null,
      body: LoadView(
        key: ValueKey(_version),
        load: () => Api.cached('/teacher/schedule'),
        builder: (context, raw, reload) {
          final slots = asList(raw);
          if (slots.isEmpty) return const EmptyState(icon: Icons.calendar_view_week, title: 'No weekly groups yet');
          final byDay = <int, List<Map<String, dynamic>>>{};
          for (final slot in slots) {
            byDay.putIfAbsent((slot['dayOfWeek'] as num).toInt(), () => []).add(slot);
          }
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            for (final day in byDay.keys.toList()..sort()) ...[
              Padding(padding: const EdgeInsets.fromLTRB(4, 10, 4, 6), child: Text(days[day], style: const TextStyle(fontWeight: FontWeight.w800, color: AppColors.accentText))),
              for (final slot in byDay[day]!)
                Card(
                  margin: const EdgeInsets.only(bottom: 8),
                  child: ListTile(
                    title: Text('${slot['startTime']} · ${slot['title']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: Text('${slot['durationMinutes'] ?? 90} min${'${slot['centerName'] ?? ''}'.isNotEmpty ? ' · ${slot['centerName']}' : ''}${slot['isActive'] == false ? ' · paused' : ''}'),
                    trailing: a.canAny(['sessions_manage', 'schedule'])
                        ? FilledButton(
                            style: FilledButton.styleFrom(minimumSize: const Size(80, 40)),
                            onPressed: () async {
                              if (!await confirm(context, 'Start a live session for ${slot['title']} now?', ok: 'Start')) return;
                              if (!context.mounted) return;
                              await attempt(context, () => Api.post('/teacher/schedule/${slot['_id']}/start'), success: 'Session started. Open Scan to check students in.');
                            },
                            child: const Text('Start'),
                          )
                        : null,
                  ),
                ),
            ],
            const SizedBox(height: 70),
          ]);
        },
      ),
    );
  }
}
