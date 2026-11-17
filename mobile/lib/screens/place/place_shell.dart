import 'package:flutter/material.dart';

import '../../services/account.dart';
import '../../services/api.dart';
import '../../services/session.dart';
import '../../theme.dart';
import '../../widgets/common.dart';
import '../home_router.dart';

/// Learning centers and schools / organizations: the same portal, only the words change.
/// Like on the website, they see teachers, groups, sessions and closings — never student details.
class PlaceShell extends StatefulWidget {
  const PlaceShell({super.key, required this.account});
  final Account account;
  @override
  State<PlaceShell> createState() => _PlaceShellState();
}

class _PlaceShellState extends State<PlaceShell> {
  int _tab = 0;
  String get _base => '/${widget.account.role.name}';
  String get _word => widget.account.role == Role.school ? 'school' : 'center';

  @override
  Widget build(BuildContext context) {
    final pages = [
      PlaceDashboard(base: _base, word: _word, account: widget.account),
      PlaceTeachers(base: _base, word: _word),
      PlaceSessions(base: _base, word: _word),
      PlaceSchedule(base: _base, word: _word),
      AccountScreen(account: widget.account),
    ];
    const titles = ['Dashboard', 'Teachers', 'Sessions & closings', 'Schedule', 'Account'];
    return Scaffold(
      appBar: AppBar(title: Text(_tab == 0 ? widget.account.name : titles[_tab])),
      body: IndexedStack(index: _tab, children: pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (index) => setState(() => _tab = index),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.dashboard_outlined), label: 'Home'),
          NavigationDestination(icon: Icon(Icons.people_outline), label: 'Teachers'),
          NavigationDestination(icon: Icon(Icons.receipt_long_outlined), label: 'Sessions'),
          NavigationDestination(icon: Icon(Icons.calendar_view_week), label: 'Schedule'),
          NavigationDestination(icon: Icon(Icons.person_outline), label: 'Account'),
        ],
      ),
    );
  }
}

class PlaceDashboard extends StatelessWidget {
  const PlaceDashboard({super.key, required this.base, required this.word, required this.account});
  final String base;
  final String word;
  final Account account;

  @override
  Widget build(BuildContext context) {
    return LoadView(
      load: () => Api.cached('$base/dashboard'),
      builder: (context, raw, _) {
        final data = asMap(raw);
        final counts = asMap(data['counts']);
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(account.role.label, style: const TextStyle(color: AppColors.muted)),
          const Gap(8),
          if ((counts['pending'] ?? 0) > 0)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: SectionCard(color: AppColors.warnSoft, child: Text('${counts['pending']} teacher(s) asked to teach at your $word. Open Teachers to answer.')),
            ),
          StatGrid(children: [
            StatTile(label: 'Teachers', value: '${counts['teachers'] ?? 0}', icon: Icons.people_outline, hint: (counts['invitations'] ?? 0) > 0 ? '${counts['invitations']} invitation(s) sent' : null),
            StatTile(label: 'Students', value: '${counts['students'] ?? 0}', icon: Icons.school_outlined, hint: 'taught at your $word'),
            StatTile(label: 'Sessions this week', value: '${counts['sessionsThisWeek'] ?? 0}', icon: Icons.event_note),
            StatTile(label: 'Attendance this week', value: '${counts['attendanceThisWeek'] ?? 0}', icon: Icons.check_circle_outline),
          ]),
          StatTile(label: 'Closings this week', value: money(data['closingsDue']), accent: true, hint: 'owed by teachers'),
          const Gap(),
          for (final session in asList(data['activeSessions']))
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: SectionCard(color: AppColors.successSoft, child: Text('Live now: ${fullName(session['teacher'])} · ${session['sequence']} · ${session['presentCount']} present')),
            ),
          SectionCard(
            title: 'Today at your $word',
            child: Column(children: [
              if (asList(data['today']).isEmpty) const Text('No groups today.', style: TextStyle(color: AppColors.muted)),
              for (final slot in asList(data['today'])) InfoRow('${slot['startTime']}', '${fullName(slot['teacher'])} · ${slot['title']}'),
            ]),
          ),
          const Gap(),
          SectionCard(
            title: 'Attendance by teacher',
            child: Column(children: [for (final row in asList(data['byTeacher'])) InfoRow('${row['label']}', '${row['value']}')]),
          ),
        ]);
      },
    );
  }
}

class PlaceTeachers extends StatefulWidget {
  const PlaceTeachers({super.key, required this.base, required this.word});
  final String base;
  final String word;
  @override
  State<PlaceTeachers> createState() => _PlaceTeachersState();
}

class _PlaceTeachersState extends State<PlaceTeachers> {
  int _version = 0;

  Future<void> _invite() async {
    final id = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Invite a teacher'),
        content: TextField(controller: id, decoration: const InputDecoration(labelText: "Teacher's username, email or phone")),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Invite')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    final done = await attempt(context, () => Api.post('${widget.base}/teachers/invite', {'identifier': id.text.trim()}), success: 'Invitation sent.');
    if (done != null) setState(() => _version++);
  }

  Future<void> _answer(String teacherId, String status) async {
    final done = await attempt(context, () => Api.patch('${widget.base}/teachers/$teacherId', {'status': status}));
    if (done != null) setState(() => _version++);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(backgroundColor: AppColors.accent, onPressed: _invite, icon: const Icon(Icons.person_add_alt), label: const Text('Invite')),
      body: LoadView(
        key: ValueKey(_version),
        load: () => Api.cached('${widget.base}/teachers'),
        builder: (context, raw, _) {
          final links = asList(raw);
          final asked = links.where((l) => l['status'] == 'pending' && l['requestedBy'] == 'teacher').toList();
          final invited = links.where((l) => l['status'] == 'pending' && l['requestedBy'] != 'teacher').toList();
          final active = links.where((l) => l['status'] == 'active').toList();
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (asked.isNotEmpty) ...[
              const Text('Asking to join', style: TextStyle(fontWeight: FontWeight.w800)),
              const Gap(6),
              for (final link in asked)
                Card(
                  margin: const EdgeInsets.only(bottom: 8),
                  color: AppColors.warnSoft,
                  child: ListTile(
                    leading: Avatar(fullName(link['teacher'])),
                    title: Text(fullName(link['teacher'])),
                    subtitle: Text((asMap(link['teacher'])['subject'] as List? ?? []).join(', ')),
                    trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                      IconButton(icon: const Icon(Icons.close, color: AppColors.danger), onPressed: () => _answer('${asMap(link['teacher'])['_id']}', 'rejected')),
                      IconButton(icon: const Icon(Icons.check, color: AppColors.success), onPressed: () => _answer('${asMap(link['teacher'])['_id']}', 'active')),
                    ]),
                  ),
                ),
              const Gap(),
            ],
            Text('Teaching at your ${widget.word} (${active.length})', style: const TextStyle(fontWeight: FontWeight.w800)),
            const Gap(6),
            if (active.isEmpty) Padding(padding: const EdgeInsets.all(12), child: Text('No teachers yet. Invite them by username, or share your ${widget.word} name so they can ask to join.', style: const TextStyle(color: AppColors.muted))),
            for (final link in active)
              Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  leading: Avatar(fullName(link['teacher'])),
                  title: Text(fullName(link['teacher']), style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text('${link['studentsCount']} students · ${link['sessionsCount']} sessions · ${link['attendanceCount']} check-ins'),
                  trailing: IconButton(
                    icon: const Icon(Icons.call, color: AppColors.accentText),
                    onPressed: '${asMap(link['teacher'])['phone'] ?? ''}'.isEmpty ? null : () => openLink('tel:${asMap(link['teacher'])['phone']}'),
                  ),
                  onLongPress: () async {
                    if (!await confirm(context, 'Remove ${fullName(link['teacher'])} from your ${widget.word}?', ok: 'Remove', danger: true)) return;
                    if (!context.mounted) return;
                    final done = await attempt(context, () => Api.delete('${widget.base}/teachers/${asMap(link['teacher'])['_id']}'));
                    if (done != null) setState(() => _version++);
                  },
                ),
              ),
            if (invited.isNotEmpty) ...[
              const Gap(),
              const Text('Invitations sent', style: TextStyle(fontWeight: FontWeight.w800)),
              for (final link in invited) ListTile(contentPadding: EdgeInsets.zero, title: Text(fullName(link['teacher'])), trailing: const Pill('Waiting', tone: Tone.warn)),
            ],
            const SizedBox(height: 80),
          ]);
        },
      ),
    );
  }
}

class PlaceSessions extends StatelessWidget {
  const PlaceSessions({super.key, required this.base, required this.word});
  final String base;
  final String word;
  @override
  Widget build(BuildContext context) {
    return LoadView(
      load: () => Api.cached('$base/sessions'),
      builder: (context, raw, _) {
        final sessions = asList(raw);
        final held = sessions.where((s) => s['status'] != 'cancelled');
        final total = held.fold<num>(0, (sum, s) => sum + ((asMap(s['closing'])['total'] as num?) ?? 0));
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          StatGrid(children: [
            StatTile(label: 'Sessions', value: '${held.length}'),
            StatTile(label: 'Closings', value: money(total), accent: true, hint: '${held.where((s) => s['closing'] == null).length} not set yet'),
          ]),
          if (sessions.isEmpty) EmptyState(icon: Icons.receipt_long, title: 'No sessions at your $word yet'),
          for (final s in sessions)
            Card(
              margin: const EdgeInsets.only(bottom: 8),
              child: ListTile(
                title: Text('${fullName(s['teacher'])} · ${s['sequence']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text('${date(s['date'])} · ${s['presentCount'] ?? 0} present${s['status'] == 'cancelled' ? ' · cancelled' : ''}'),
                trailing: s['closing'] == null ? const Pill('Not set') : Text(money(asMap(s['closing'])['total']), style: const TextStyle(fontWeight: FontWeight.w800)),
              ),
            ),
        ]);
      },
    );
  }
}

class PlaceSchedule extends StatelessWidget {
  const PlaceSchedule({super.key, required this.base, required this.word});
  final String base;
  final String word;
  @override
  Widget build(BuildContext context) {
    return LoadView(
      load: () => Api.cached('$base/schedule'),
      builder: (context, raw, _) {
        final slots = asList(raw).where((slot) => slot['isActive'] != false).toList();
        if (slots.isEmpty) return EmptyState(icon: Icons.calendar_view_week, title: 'No weekly groups at your $word yet');
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
                child: ListTile(title: Text('${slot['startTime']} · ${fullName(slot['teacher'])}'), subtitle: Text('${slot['title']} · ${slot['durationMinutes'] ?? 90} min')),
              ),
          ],
        ]);
      },
    );
  }
}
