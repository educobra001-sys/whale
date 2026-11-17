import 'package:flutter/material.dart';

import '../../services/account.dart';
import '../../services/api.dart';
import '../../theme.dart';
import '../../widgets/common.dart';
import '../student/student_shell.dart' show AttendanceLine;

class StudentsScreen extends StatefulWidget {
  const StudentsScreen({super.key, required this.account});
  final Account account;
  @override
  State<StudentsScreen> createState() => _StudentsScreenState();
}

class _StudentsScreenState extends State<StudentsScreen> {
  final _search = TextEditingController();
  String _filter = 'all';
  int _version = 0;

  bool _matches(Map<String, dynamic> s) {
    final q = _search.text.trim().toLowerCase();
    if (_filter == 'low' && (s['balance'] ?? 0) >= (s['pricePerSession'] ?? 1)) return false;
    if (_filter == 'blocked' && s['isBlocked'] != true) return false;
    if (q.isEmpty) return true;
    return '${fullName(s)} ${s['userID']} ${s['phone']} ${s['parentPhone']}'.toLowerCase().contains(q);
  }

  @override
  Widget build(BuildContext context) {
    final a = widget.account;
    return Scaffold(
      floatingActionButton: a.can('students_manage')
          ? FloatingActionButton.extended(
              backgroundColor: AppColors.accent,
              onPressed: () async {
                final added = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => const AddStudentScreen()));
                if (added == true) setState(() => _version++);
              },
              icon: const Icon(Icons.person_add_alt),
              label: const Text('Add student'),
            )
          : null,
      body: LoadView(
        key: ValueKey(_version),
        scroll: false,
        load: () => Api.cached('/teacher/myStudents'),
        builder: (context, raw, reload) {
          final all = asList(raw);
          final shown = all.where(_matches).toList();
          return ListView(padding: const EdgeInsets.fromLTRB(16, 4, 16, 90), children: [
            TextField(
              controller: _search,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(hintText: 'Name, code or phone', prefixIcon: Icon(Icons.search)),
            ),
            const Gap(8),
            Wrap(spacing: 8, children: [
              for (final (key, label) in [('all', 'All (${all.length})'), ('low', 'Low balance'), ('blocked', 'Blocked')])
                ChoiceChip(label: Text(label), selected: _filter == key, selectedColor: AppColors.accentSoft, onSelected: (_) => setState(() => _filter = key)),
              if (a.can('students_manage'))
                ActionChip(
                  avatar: const Icon(Icons.how_to_reg, size: 18),
                  label: const Text('Join requests'),
                  onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const JoinRequestsScreen())).then((_) => reload()),
                ),
            ]),
            const Gap(8),
            if (shown.isEmpty) const EmptyState(icon: Icons.people_outline, title: 'No students match'),
            for (final s in shown)
              Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  leading: Avatar(fullName(s)),
                  title: Text(fullName(s), style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text('${s['userID']} · ${gradeLabel(s['grade'])}${'${s['centerName'] ?? ''}'.isNotEmpty ? ' · ${s['centerName']}' : ''}'),
                  trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                    Text(money(s['balance']), style: TextStyle(fontWeight: FontWeight.w800, color: (s['balance'] ?? 0) < 0 ? AppColors.danger : AppColors.ink)),
                    if (s['isBlocked'] == true) const Pill('Blocked', tone: Tone.danger) else Text('${s['points'] ?? 0} pts', style: const TextStyle(color: AppColors.muted, fontSize: 12)),
                  ]),
                  onTap: () async {
                    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => StudentDetailScreen(account: a, studentId: '${s['_id']}')));
                    await reload();
                  },
                ),
              ),
          ]);
        },
      ),
    );
  }
}

class StudentDetailScreen extends StatefulWidget {
  const StudentDetailScreen({super.key, required this.account, required this.studentId});
  final Account account;
  final String studentId;
  @override
  State<StudentDetailScreen> createState() => _StudentDetailScreenState();
}

class _StudentDetailScreenState extends State<StudentDetailScreen> {
  int _version = 0;
  String get _base => '/teacher/myStudents/${widget.studentId}';

  Future<void> _amountDialog({required String title, required String field, required String path, bool signed = true}) async {
    final amount = TextEditingController(), reason = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(
            controller: amount,
            keyboardType: const TextInputType.numberWithOptions(signed: true),
            decoration: InputDecoration(labelText: signed ? 'Amount (use - to subtract)' : 'Amount'),
          ),
          const Gap(),
          TextField(controller: reason, decoration: const InputDecoration(labelText: 'Reason')),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Save')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    final value = num.tryParse(amount.text.trim());
    if (value == null) return toast(context, 'Enter a number.', error: true);
    final done = await attempt(context, () => Api.post('$_base/$path', {field: value, if (reason.text.trim().isNotEmpty) 'reason': reason.text.trim()}), success: 'Saved.');
    if (done != null) setState(() => _version++);
  }

  Future<void> _warning() async {
    final reason = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Give a warning'),
        content: TextField(controller: reason, decoration: const InputDecoration(labelText: 'Reason')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Give warning')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    final done = await attempt(context, () => Api.post('$_base/warnings', {'reason': reason.text.trim()}), success: 'Warning added. Three warnings block the student.');
    if (done != null) setState(() => _version++);
  }

  @override
  Widget build(BuildContext context) {
    final a = widget.account;
    return Scaffold(
      appBar: AppBar(title: const Text('Student')),
      body: LoadView(
        key: ValueKey(_version),
        load: () async {
          final student = await Api.get(_base);
          dynamic history;
          try {
            history = await Api.get('$_base/history');
          } catch (_) {/* history is optional */}
          return Loaded({'student': student, 'history': history});
        },
        builder: (context, raw, reload) {
          final s = asMap(asMap(raw)['student']);
          final history = asMap(asMap(raw)['history']);
          final phone = '${s['phone'] ?? ''}', parent = '${s['parentPhone'] ?? ''}';
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            SectionCard(
              child: Row(children: [
                Avatar(fullName(s), size: 56),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(fullName(s), style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800)),
                    SelectableText('${s['userID']}', style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.accentText)),
                    Text('${gradeLabel(s['grade'])}${'${s['schoolName'] ?? ''}'.isNotEmpty ? ' · ${s['schoolName']}' : ''}', style: const TextStyle(color: AppColors.muted)),
                  ]),
                ),
                if (s['isBlocked'] == true) const Pill('Blocked', tone: Tone.danger),
              ]),
            ),
            const Gap(),
            StatGrid(children: [
              StatTile(label: 'Balance', value: money(s['balance']), accent: true, hint: s['pricePerSession'] != null ? '${money(s['pricePerSession'])} / session' : null),
              StatTile(label: 'Points', value: '${s['points'] ?? 0}', hint: '${s['warningsCount'] ?? 0} warning(s)'),
            ]),
            SectionCard(
              title: 'Contact',
              child: Column(children: [
                for (final (label, number) in [('Student', phone), ('Parent', parent)])
                  if (number.isNotEmpty)
                    Row(children: [
                      SizedBox(width: 70, child: Text(label, style: const TextStyle(color: AppColors.muted))),
                      Expanded(child: Text(number)),
                      IconButton(icon: const Icon(Icons.call, color: AppColors.accentText), onPressed: () => openLink('tel:$number')),
                      IconButton(icon: const Icon(Icons.chat, color: AppColors.success), onPressed: () => openLink('https://wa.me/20${number.replaceFirst(RegExp('^0'), '')}')),
                    ]),
              ]),
            ),
            const Gap(),
            Wrap(spacing: 8, runSpacing: 8, children: [
              if (a.can('students_balance')) ...[
                OutlinedButton.icon(onPressed: () => _amountDialog(title: 'Change balance', field: 'amount', path: 'balance'), icon: const Icon(Icons.account_balance_wallet_outlined), label: const Text('Balance')),
                OutlinedButton.icon(onPressed: () => _amountDialog(title: 'Give points', field: 'points', path: 'points'), icon: const Icon(Icons.emoji_events_outlined), label: const Text('Points')),
              ],
              if (a.can('warnings')) OutlinedButton.icon(onPressed: _warning, icon: const Icon(Icons.report_outlined), label: const Text('Warning')),
              if (a.can('students_manage'))
                OutlinedButton.icon(
                  onPressed: () async {
                    final blocked = s['isBlocked'] == true;
                    if (!await confirm(context, blocked ? 'Unblock this student?' : 'Block this student? They can\'t check in until unblocked.', ok: blocked ? 'Unblock' : 'Block', danger: !blocked)) return;
                    if (!context.mounted) return;
                    final done = await attempt(context, () => Api.patch('$_base/block', {'blocked': !blocked}));
                    if (done != null) setState(() => _version++);
                  },
                  icon: Icon(s['isBlocked'] == true ? Icons.lock_open : Icons.block),
                  label: Text(s['isBlocked'] == true ? 'Unblock' : 'Block'),
                ),
            ]),
            if ('${s['adminNote'] ?? ''}'.isNotEmpty) ...[const Gap(), SectionCard(title: 'Note', child: Text('${s['adminNote']}'))],
            const Gap(),
            SectionCard(
              title: 'Recent sessions',
              child: Column(children: [
                if (asList(history['attendance']).isEmpty) const Text('No sessions yet.', style: TextStyle(color: AppColors.muted)),
                for (final row in asList(history['attendance']).take(10)) Padding(padding: const EdgeInsets.only(bottom: 12), child: AttendanceLine(row: row)),
              ]),
            ),
            if (asList(history['exams']).isNotEmpty) ...[
              const Gap(),
              SectionCard(
                title: 'Exams',
                child: Column(children: [
                  for (final row in asList(history['exams'])) InfoRow('${asMap(row['exam'])['name']}', row['score'] == null ? '—' : '${row['score']} / ${asMap(row['exam'])['maxScore']}'),
                ]),
              ),
            ],
            if (asList(history['transactions']).isNotEmpty) ...[
              const Gap(),
              SectionCard(
                title: 'Payments',
                child: Column(children: [
                  for (final row in asList(history['transactions']).take(15))
                    InfoRow(date(row['createdAt']), '${row['reason'] ?? row['type']} · ${money(row['amount'])}', valueColor: (row['amount'] as num) >= 0 ? AppColors.success : AppColors.danger),
                ]),
              ),
            ],
          ]);
        },
      ),
    );
  }
}

class AddStudentScreen extends StatefulWidget {
  const AddStudentScreen({super.key});
  @override
  State<AddStudentScreen> createState() => _AddStudentScreenState();
}

class _AddStudentScreenState extends State<AddStudentScreen> {
  final _first = TextEditingController(), _last = TextEditingController(), _phone = TextEditingController();
  final _parent = TextEditingController(), _balance = TextEditingController(), _price = TextEditingController(), _existing = TextEditingController();
  String _grade = '0';
  bool _busy = false;
  Map<String, dynamic>? _created;

  Future<void> _create() async {
    setState(() => _busy = true);
    final result = await attempt(context, () => Api.post('/teacher/myStudents', {
          'firstName': _first.text.trim(),
          'lastName': _last.text.trim(),
          'phone': _phone.text.trim(),
          if (_parent.text.trim().isNotEmpty) 'parentPhone': _parent.text.trim(),
          'grade': _grade,
          if (_balance.text.trim().isNotEmpty) 'balance': num.tryParse(_balance.text.trim()) ?? 0,
          if (_price.text.trim().isNotEmpty) 'pricePerSession': num.tryParse(_price.text.trim()),
        }));
    if (mounted) setState(() => (_busy = false, _created = result == null ? null : asMap(result)));
  }

  Future<void> _link() async {
    setState(() => _busy = true);
    final done = await attempt(context, () => Api.post('/teacher/myStudents/link', {'identifier': _existing.text.trim()}), success: 'Student added to your class.');
    if (!mounted) return;
    setState(() => _busy = false);
    if (done != null) Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    final created = _created;
    return Scaffold(
      appBar: AppBar(title: const Text('Add student')),
      body: created != null
          ? ListView(padding: const EdgeInsets.all(24), children: [
              const Text('Student added', textAlign: TextAlign.center, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
              const Gap(),
              InfoRow('Student code', '${created['userID']}'),
              if (created['password'] != null) InfoRow('Password', '${created['password']}'),
              const Text('Give these to the student so they can sign in to the app.', style: TextStyle(color: AppColors.muted)),
              const Gap(20),
              FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Done')),
            ])
          : ListView(padding: const EdgeInsets.all(16), children: [
              SectionCard(
                title: 'Already on EduCobra?',
                child: Column(children: [
                  TextField(controller: _existing, decoration: const InputDecoration(labelText: 'Their student code or phone')),
                  const Gap(8),
                  OutlinedButton(onPressed: _busy ? null : _link, child: const Text('Add to my class')),
                ]),
              ),
              const Gap(),
              SectionCard(
                title: 'New student',
                child: Column(children: [
                  TextField(controller: _first, decoration: const InputDecoration(labelText: 'First name')),
                  const Gap(8),
                  TextField(controller: _last, decoration: const InputDecoration(labelText: 'Last name')),
                  const Gap(8),
                  TextField(controller: _phone, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Phone')),
                  const Gap(8),
                  TextField(controller: _parent, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Parent phone')),
                  const Gap(8),
                  DropdownButtonFormField<String>(
                    initialValue: _grade,
                    decoration: const InputDecoration(labelText: 'Grade'),
                    items: [for (var i = 0; i < grades.length; i++) DropdownMenuItem(value: '$i', child: Text(grades[i]))],
                    onChanged: (value) => _grade = value ?? '0',
                  ),
                  const Gap(8),
                  TextField(controller: _balance, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Starting balance (optional)')),
                  const Gap(8),
                  TextField(controller: _price, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Price per session (optional)')),
                  const Gap(14),
                  FilledButton(onPressed: _busy ? null : _create, child: const Text('Create student')),
                ]),
              ),
            ]),
    );
  }
}

class JoinRequestsScreen extends StatelessWidget {
  const JoinRequestsScreen({super.key});
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Join requests')),
      body: LoadView(
        load: () async => Loaded(await Api.get('/teacher/requests')),
        builder: (context, raw, reload) {
          final rows = asList(raw);
          if (rows.isEmpty) return const EmptyState(icon: Icons.how_to_reg, title: 'No requests');
          return Column(children: [
            for (final row in rows)
              Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  title: Text(fullName(row['student'] ?? row)),
                  subtitle: Text('${asMap(row['student'])['userID'] ?? ''} · ${date(row['createdAt'])}'),
                  trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                    IconButton(
                      icon: const Icon(Icons.close, color: AppColors.danger),
                      onPressed: () async => (await attempt(context, () => Api.patch('/teacher/requests/${row['_id']}', {'status': 'rejected'}))) != null ? reload() : null,
                    ),
                    IconButton(
                      icon: const Icon(Icons.check, color: AppColors.success),
                      onPressed: () async => (await attempt(context, () => Api.patch('/teacher/requests/${row['_id']}', {'status': 'accepted'}))) != null ? reload() : null,
                    ),
                  ]),
                ),
              ),
          ]);
        },
      ),
    );
  }
}
