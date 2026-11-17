import 'package:flutter/material.dart';

import '../../services/account.dart';
import '../../services/api.dart';
import '../../theme.dart';
import '../../widgets/common.dart';
import '../home_router.dart';
import '../student/student_shell.dart' show AttendanceLine;

/// The parent follows each child with each of the child's teachers.
class ParentShell extends StatefulWidget {
  const ParentShell({super.key, required this.account});
  final Account account;
  @override
  State<ParentShell> createState() => _ParentShellState();
}

class _ParentShellState extends State<ParentShell> {
  int _tab = 0;
  String? _childId;
  String? _teacherId;
  late List<Map<String, dynamic>> _children = asList(widget.account.profile['children']);

  Map<String, dynamic>? get _child => _children.where((child) => '${child['_id']}' == _childId).firstOrNull ?? _children.firstOrNull;

  Future<void> _reloadProfile() async {
    final profile = asMap(await Api.get('/parent/profile'));
    setState(() => _children = asList(profile['children']));
  }

  Future<void> _linkChild() async {
    final code = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Add a child'),
        content: TextField(controller: code, decoration: const InputDecoration(labelText: 'Student code (STU-…)')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Add')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    final done = await attempt(context, () => Api.post('/parent/children', {'code': code.text.trim()}), success: 'Child added.');
    if (done != null) await _reloadProfile();
  }

  @override
  Widget build(BuildContext context) {
    final child = _child;
    final teachers = asList(child?['teachers']);
    final teacherId = teachers.any((t) => '${t['_id']}' == _teacherId) ? _teacherId : (teachers.isNotEmpty ? '${teachers.first['_id']}' : null);
    return Scaffold(
      appBar: AppBar(
        title: _children.length > 1
            ? DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  value: '${child?['_id']}',
                  isExpanded: true,
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppColors.ink),
                  items: [for (final c in _children) DropdownMenuItem(value: '${c['_id']}', child: Text(fullName(c)))],
                  onChanged: (value) => setState(() => (_childId = value, _teacherId = null)),
                ),
              )
            : Text(child == null ? 'EduCobra' : fullName(child)),
        actions: [IconButton(onPressed: _linkChild, icon: const Icon(Icons.person_add_alt))],
      ),
      body: _tab == 1
          ? AccountScreen(account: widget.account)
          : child == null
              ? EmptyState(icon: Icons.family_restroom, title: 'No children linked', text: 'Add your child with their student code.', action: FilledButton(onPressed: _linkChild, child: const Text('Add a child')))
              : Column(children: [
                  if (teachers.length > 1)
                    SizedBox(
                      height: 52,
                      child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8), children: [
                        for (final t in teachers)
                          Padding(
                            padding: const EdgeInsets.only(right: 8),
                            child: ChoiceChip(label: Text(fullName(t)), selected: '${t['_id']}' == teacherId, selectedColor: AppColors.accentSoft, onSelected: (_) => setState(() => _teacherId = '${t['_id']}')),
                          ),
                      ]),
                    ),
                  Expanded(child: ChildReport(key: ValueKey('${child['_id']}$teacherId'), childId: '${child['_id']}', teacherId: teacherId)),
                ]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (index) => setState(() => _tab = index),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.favorite_outline), selectedIcon: Icon(Icons.favorite), label: 'Follow-up'),
          NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Account'),
        ],
      ),
    );
  }
}

class ChildReport extends StatelessWidget {
  const ChildReport({super.key, required this.childId, this.teacherId});
  final String childId;
  final String? teacherId;

  @override
  Widget build(BuildContext context) {
    return LoadView(
      load: () => Api.cached('/parent/children/$childId/report', {'teacher': teacherId}),
      builder: (context, raw, _) {
        final data = asMap(raw);
        final stats = asMap(data['stats']);
        final follow = asMap(data['followUp']);
        final phone = '${follow['teacherPhone'] ?? ''}';
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          if (data['isBlocked'] == true)
            const Padding(padding: EdgeInsets.only(bottom: 12), child: SectionCard(color: AppColors.dangerSoft, child: Text('Blocked by the teacher. Please contact them.'))),
          StatGrid(children: [
            StatTile(label: 'Balance', value: money(data['balance']), icon: Icons.account_balance_wallet_outlined, accent: true),
            StatTile(label: 'Points', value: '${data['points'] ?? 0}', icon: Icons.emoji_events_outlined),
            StatTile(label: 'Attendance', value: '${stats['attendanceRate'] ?? 0}%', hint: '${stats['present'] ?? 0} present · ${stats['absent'] ?? 0} absent'),
            StatTile(label: 'Homework', value: '${stats['homeworkRate'] ?? 0}%', hint: 'Exam average ${stats['examAvg'] ?? 0}%'),
          ]),
          if (phone.isNotEmpty)
            SectionCard(
              title: 'Contact the teacher',
              child: Row(children: [
                Expanded(child: Text(phone)),
                IconButton(icon: const Icon(Icons.call, color: AppColors.accentText), onPressed: () => openLink('tel:$phone')),
                IconButton(icon: const Icon(Icons.chat, color: AppColors.success), onPressed: () => openLink('https://wa.me/20${phone.replaceFirst(RegExp('^0'), '')}')),
              ]),
            ),
          if (asMap(follow['lastComment']).isNotEmpty) ...[
            const Gap(),
            SectionCard(title: 'Latest follow-up note', child: Text('${asMap(follow['lastComment'])['comment']}')),
          ],
          if (asList(data['warnings']).isNotEmpty) ...[
            const Gap(),
            SectionCard(
              title: 'Warnings',
              color: AppColors.warnSoft,
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [for (final w in asList(data['warnings'])) Text('• ${w['reason'] ?? 'Warning'} — ${date(w['createdAt'])}')]),
            ),
          ],
          const Gap(),
          SectionCard(
            title: 'Sessions',
            child: Column(children: [
              if (asList(data['sessions']).isEmpty) const Text('No sessions yet.', style: TextStyle(color: AppColors.muted)),
              for (final row in asList(data['sessions'])) Padding(padding: const EdgeInsets.only(bottom: 12), child: AttendanceLine(row: row)),
            ]),
          ),
          const Gap(),
          SectionCard(
            title: 'Exams',
            child: Column(children: [
              if (asList(data['exams']).isEmpty) const Text('No exams yet.', style: TextStyle(color: AppColors.muted)),
              for (final row in asList(data['exams']))
                InfoRow('${asMap(row['exam'])['name']}', row['score'] == null ? 'No score' : '${row['score']} / ${asMap(row['exam'])['maxScore']}'),
            ]),
          ),
          const Gap(),
          SectionCard(
            title: 'Payments',
            child: Column(children: [
              for (final row in asList(data['transactions']).take(30))
                InfoRow(date(row['createdAt']), '${row['reason'] ?? row['type']} · ${money(row['amount'])}', valueColor: (row['amount'] as num) >= 0 ? AppColors.success : AppColors.danger),
            ]),
          ),
        ]);
      },
    );
  }
}
