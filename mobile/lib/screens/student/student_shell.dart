import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../services/account.dart';
import '../../services/api.dart';
import '../../theme.dart';
import '../../widgets/common.dart';
import '../home_router.dart';
import 'student_learning.dart';
import 'student_more.dart';

/// The student portal. A student can study with several teachers; one is in focus at a time.
class StudentShell extends StatefulWidget {
  const StudentShell({super.key, required this.account});
  final Account account;
  @override
  State<StudentShell> createState() => _StudentShellState();
}

class _StudentShellState extends State<StudentShell> {
  static const _teacherKey = 'student.teacher';
  int _tab = 0;
  List<Map<String, dynamic>> _teachers = [];
  String? _teacherId;
  bool _loading = true;
  bool _fromCache = false;

  @override
  void initState() {
    super.initState();
    _loadTeachers();
  }

  Future<void> _loadTeachers() async {
    try {
      final loaded = await Api.cached('/student/teachers');
      final prefs = await SharedPreferences.getInstance();
      final active = asList(loaded.data).where((entry) => entry['status'] == 'active').toList();
      final stored = prefs.getString(_teacherKey);
      setState(() {
        _teachers = asList(loaded.data);
        _fromCache = loaded.fromCache;
        _teacherId = active.any((entry) => entry['teacher']['_id'] == stored) ? stored : (active.isNotEmpty ? '${active.first['teacher']['_id']}' : null);
      });
    } catch (_) {
      // Shown below as "no teachers".
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _pickTeacher(String id) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_teacherKey, id);
    setState(() => _teacherId = id);
  }

  Map<String, dynamic>? get _teacher => _teachers.where((entry) => '${entry['teacher']['_id']}' == _teacherId).firstOrNull?['teacher'];

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    final active = _teachers.where((entry) => entry['status'] == 'active').toList();
    final teacherId = _teacherId;
    if (teacherId == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Find your teachers')),
        body: TeachersScreen(onChanged: _loadTeachers, embedded: true),
        bottomNavigationBar: SafeArea(child: TextButton(onPressed: () => signOut(context), child: const Text('Sign out'))),
      );
    }
    final pages = [
      StudentHome(key: ValueKey('home$teacherId'), teacherId: teacherId, account: widget.account),
      StudentSessions(key: ValueKey('sessions$teacherId'), teacherId: teacherId),
      LessonsTab(key: ValueKey('lessons$teacherId'), teacherId: teacherId),
      HomeworkTab(key: ValueKey('homework$teacherId'), teacherId: teacherId),
      StudentMore(key: ValueKey('more$teacherId'), teacherId: teacherId, account: widget.account, onTeachersChanged: _loadTeachers),
    ];
    return Scaffold(
      appBar: AppBar(
        title: active.length > 1
            ? DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  value: teacherId,
                  isExpanded: true,
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppColors.ink),
                  items: [for (final entry in active) DropdownMenuItem(value: '${entry['teacher']['_id']}', child: Text(fullName(entry['teacher']), overflow: TextOverflow.ellipsis))],
                  onChanged: (value) => value == null ? null : _pickTeacher(value),
                ),
              )
            : Text(fullName(_teacher)),
        actions: [if (_fromCache) const Padding(padding: EdgeInsets.only(right: 12), child: Icon(Icons.cloud_off, color: AppColors.warn))],
      ),
      body: IndexedStack(index: _tab, children: pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (index) => setState(() => _tab = index),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Home'),
          NavigationDestination(icon: Icon(Icons.event_available_outlined), selectedIcon: Icon(Icons.event_available), label: 'Sessions'),
          NavigationDestination(icon: Icon(Icons.play_circle_outline), selectedIcon: Icon(Icons.play_circle), label: 'Lessons'),
          NavigationDestination(icon: Icon(Icons.edit_note_outlined), selectedIcon: Icon(Icons.edit_note), label: 'Homework'),
          NavigationDestination(icon: Icon(Icons.more_horiz), label: 'More'),
        ],
      ),
    );
  }
}

class StudentHome extends StatelessWidget {
  const StudentHome({super.key, required this.teacherId, required this.account});
  final String teacherId;
  final Account account;

  @override
  Widget build(BuildContext context) {
    return LoadView(
      load: () => Api.cached('/student/teachers/$teacherId/overview'),
      builder: (context, raw, reload) {
        final data = asMap(raw);
        final stats = asMap(data['stats']);
        final next = asMap(data['nextSlot']);
        final last = asMap(data['lastSession']);
        final warnings = asList(data['warnings']);
        final follow = asMap(data['followUp']);
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          if (data['isBlocked'] == true)
            const Padding(
              padding: EdgeInsets.only(bottom: 12),
              child: SectionCard(color: AppColors.dangerSoft, child: Text('Your account with this teacher is blocked. Talk to your teacher.', style: TextStyle(color: AppColors.danger, fontWeight: FontWeight.w700))),
            ),
          const DoorCode(),
          const Gap(),
          StatGrid(children: [
            StatTile(label: 'Balance', value: money(data['balance']), icon: Icons.account_balance_wallet_outlined, accent: true, hint: data['pricePerSession'] != null ? '${money(data['pricePerSession'])} per session' : null),
            StatTile(label: 'Points', value: '${data['points'] ?? 0}', icon: Icons.emoji_events_outlined, hint: data['rank'] != null ? 'Rank ${data['rank']} of ${data['classSize']}' : null),
            StatTile(label: 'Attendance', value: '${stats['attendanceRate'] ?? 0}%', icon: Icons.check_circle_outline, hint: '${stats['present'] ?? 0} present · ${stats['absent'] ?? 0} absent'),
            StatTile(label: 'Homework', value: '${stats['homeworkRate'] ?? 0}%', icon: Icons.edit_note, hint: 'Exam average ${stats['examAvg'] ?? 0}%'),
          ]),
          OutlinedButton.icon(onPressed: () => rechargeDialog(context, reload), icon: const Icon(Icons.redeem), label: const Text('Recharge with a code')),
          const Gap(),
          if (next.isNotEmpty)
            SectionCard(
              title: 'Next group',
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${days[(next['dayOfWeek'] ?? 0) as int]} · ${next['startTime']} · ${next['title'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
                if ('${next['centerName'] ?? ''}'.isNotEmpty) Text('${next['centerName']}', style: const TextStyle(color: AppColors.muted)),
                if (next['startsInMinutes'] != null) Text(_startsIn(next['startsInMinutes']), style: const TextStyle(color: AppColors.accentText)),
              ]),
            ),
          if (last.isNotEmpty) ...[
            const Gap(),
            SectionCard(title: 'Last session', child: AttendanceLine(row: last)),
          ],
          if (warnings.isNotEmpty) ...[
            const Gap(),
            SectionCard(
              title: 'Warnings (${warnings.length})',
              color: AppColors.warnSoft,
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [for (final w in warnings) Text('• ${w['reason'] ?? 'Warning'} — ${date(w['createdAt'])}')]),
            ),
          ],
          if (follow.isNotEmpty && follow['lastComment'] != null) ...[
            const Gap(),
            SectionCard(title: 'Follow-up', child: Text('${asMap(follow['lastComment'])['comment'] ?? ''}')),
          ],
          for (final item in asList(data['announcements'])) ...[
            const Gap(),
            SectionCard(
              title: '${item['title'] ?? 'Announcement'}',
              trailing: item['pinned'] == true ? const Pill('Pinned', tone: Tone.accent) : null,
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                if ('${item['body'] ?? ''}'.isNotEmpty) Text('${item['body']}'),
                if ('${item['linkUrl'] ?? ''}'.isNotEmpty) TextButton(onPressed: () => openLink('${item['linkUrl']}'), child: const Text('Open link')),
              ]),
            ),
          ],
        ]);
      },
    );
  }

  String _startsIn(dynamic minutes) {
    final m = (minutes as num).round();
    if (m < 60) return 'Starts in $m minutes';
    if (m < 60 * 24) return 'Starts in ${m ~/ 60}h ${m % 60}m';
    return 'In ${m ~/ (60 * 24)} days';
  }
}

/// The student's code and QR for the door. Kept on the phone, so it shows with no internet.
class DoorCode extends StatelessWidget {
  const DoorCode({super.key});
  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Loaded<dynamic>>(
      future: Api.cached('/me/qr'),
      builder: (context, snapshot) {
        final data = asMap(snapshot.data?.data);
        return SectionCard(
          child: Row(children: [
            if (data['qrCode'] is String)
              GestureDetector(
                onTap: () => showDialog(context: context, builder: (_) => Dialog(child: Padding(padding: const EdgeInsets.all(20), child: DataImage(data['qrCode'], size: 280)))),
                child: DataImage(data['qrCode'], size: 96),
              )
            else
              const SizedBox(width: 96, height: 96, child: Center(child: CircularProgressIndicator(strokeWidth: 2))),
            const SizedBox(width: 14),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('Your door code', style: TextStyle(color: AppColors.muted)),
                Text('${data['userID'] ?? ''}', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, letterSpacing: 1)),
                const Text('Show the QR at the door. Tap it to enlarge.', style: TextStyle(color: AppColors.muted, fontSize: 12)),
              ]),
            ),
          ]),
        );
      },
    );
  }
}

Future<void> rechargeDialog(BuildContext context, Future<void> Function() reload) async {
  final code = TextEditingController();
  final ok = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('Recharge code'),
      content: TextField(controller: code, textCapitalization: TextCapitalization.characters, decoration: const InputDecoration(hintText: 'EC-XXXXXXXX')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
        TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Recharge')),
      ],
    ),
  );
  if (ok != true || !context.mounted) return;
  final result = await attempt(context, () => Api.post('/student/recharge', {'code': code.text.trim()}));
  if (result != null && context.mounted) {
    final data = asMap(result);
    toast(context, data['amount'] != null ? 'Added ${money(data['amount'])}.' : 'Code used.');
    await reload();
  }
}

/// One attendance record: present/absent, homework, payment.
class AttendanceLine extends StatelessWidget {
  const AttendanceLine({super.key, required this.row});
  final Map<String, dynamic> row;
  @override
  Widget build(BuildContext context) {
    final session = asMap(row['session']);
    final present = row['status'] == 'present';
    return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Icon(present ? Icons.check_circle : Icons.cancel, color: present ? AppColors.success : AppColors.danger),
      const SizedBox(width: 10),
      Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Week ${session['week']} · #${session['number']} · ${session['sequence'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
          Text('${date(session['date'])}${'${session['centerName'] ?? ''}'.isNotEmpty ? ' · ${session['centerName']}' : ''}', style: const TextStyle(color: AppColors.muted, fontSize: 13)),
          const SizedBox(height: 4),
          Wrap(spacing: 6, runSpacing: 4, children: [
            Pill(present ? 'Present' : 'Absent', tone: present ? Tone.success : Tone.danger),
            if (homeworkLabel(row['homeworkStatus']).isNotEmpty) Pill('Homework: ${homeworkLabel(row['homeworkStatus'])}', tone: homeworkTone(row['homeworkStatus'])),
            if ((num.tryParse('${row['charged']}') ?? 0) > 0) Pill('Charged ${money(row['charged'])}'),
            if ((num.tryParse('${row['payment']}') ?? 0) > 0) Pill('Paid ${money(row['payment'])}', tone: Tone.info),
          ]),
          if ('${row['comment'] ?? ''}'.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 4), child: Text('${row['comment']}', style: const TextStyle(fontSize: 13))),
        ]),
      ),
    ]);
  }
}

class StudentSessions extends StatelessWidget {
  const StudentSessions({super.key, required this.teacherId});
  final String teacherId;
  @override
  Widget build(BuildContext context) {
    return LoadView(
      load: () => Api.cached('/student/teachers/$teacherId/sessions'),
      builder: (context, raw, reload) {
        final rows = asList(raw);
        if (rows.isEmpty) return const EmptyState(icon: Icons.event_busy, title: 'No sessions yet');
        return Column(children: [
          for (final row in rows) Padding(padding: const EdgeInsets.only(bottom: 10), child: SectionCard(child: AttendanceLine(row: row))),
        ]);
      },
    );
  }
}
