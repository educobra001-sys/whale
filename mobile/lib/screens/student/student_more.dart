import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../../services/account.dart';
import '../../services/api.dart';
import '../../theme.dart';
import '../../widgets/common.dart';
import '../home_router.dart';
import 'student_shell.dart';

class StudentMore extends StatelessWidget {
  const StudentMore({super.key, required this.teacherId, required this.account, required this.onTeachersChanged});
  final String teacherId;
  final Account account;
  final Future<void> Function() onTeachersChanged;

  @override
  Widget build(BuildContext context) {
    void open(String title, Widget body) => Navigator.of(context).push(MaterialPageRoute(builder: (_) => Scaffold(appBar: AppBar(title: Text(title)), body: body)));
    final items = <(IconData, String, Widget)>[
      (Icons.workspace_premium_outlined, 'Exams', ExamsScreen(teacherId: teacherId)),
      (Icons.menu_book_outlined, 'Booklets', BookletsScreen(teacherId: teacherId)),
      (Icons.account_balance_wallet_outlined, 'Wallet', WalletScreen(teacherId: teacherId)),
      (Icons.emoji_events_outlined, 'Leaderboard', LeaderboardScreen(teacherId: teacherId)),
      (Icons.groups_outlined, 'My teachers', TeachersScreen(onChanged: onTeachersChanged)),
      (Icons.person_outline, 'Account', AccountScreen(account: account)),
    ];
    return ListView(padding: const EdgeInsets.all(16), children: [
      for (final (icon, title, body) in items)
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Card(
            child: ListTile(
              leading: Icon(icon, color: AppColors.accentText),
              title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => open(title, body),
            ),
          ),
        ),
    ]);
  }
}

class ExamsScreen extends StatelessWidget {
  const ExamsScreen({super.key, required this.teacherId});
  final String teacherId;
  @override
  Widget build(BuildContext context) {
    return LoadView(
      load: () => Api.cached('/student/teachers/$teacherId/exams'),
      builder: (context, raw, _) {
        final rows = asList(raw);
        if (rows.isEmpty) return const EmptyState(icon: Icons.workspace_premium_outlined, title: 'No exams yet');
        return Column(children: [
          for (final row in rows)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: SectionCard(
                title: '${asMap(row['exam'])['name']}',
                trailing: row['score'] == null ? const Pill('No score') : Pill('${row['score']} / ${asMap(row['exam'])['maxScore']}', tone: Tone.success),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(date(asMap(row['exam'])['date']), style: const TextStyle(color: AppColors.muted)),
                  if (row['rank'] != null) Text('Rank ${row['rank']} of ${row['participants']}'),
                  Text('Class average ${asMap(row['stats'])['avg'] ?? 0} · best ${asMap(row['stats'])['max'] ?? 0}', style: const TextStyle(fontSize: 13)),
                ]),
              ),
            ),
        ]);
      },
    );
  }
}

class BookletsScreen extends StatelessWidget {
  const BookletsScreen({super.key, required this.teacherId});
  final String teacherId;
  @override
  Widget build(BuildContext context) {
    return LoadView(
      load: () => Api.cached('/student/teachers/$teacherId/booklets'),
      builder: (context, raw, reload) {
        final rows = asList(raw);
        if (rows.isEmpty) return const EmptyState(icon: Icons.menu_book_outlined, title: 'No booklets yet');
        return Column(children: [
          for (final row in rows)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: SectionCard(
                title: '${asMap(row['booklet'])['name']}',
                trailing: Text(money(asMap(row['booklet'])['sellPrice']), style: const TextStyle(fontWeight: FontWeight.w800)),
                child: row['order'] != null
                    ? Align(
                        alignment: Alignment.centerLeft,
                        child: Pill(asMap(row['order'])['delivered'] == true ? 'Delivered' : 'Reserved · ${asMap(row['order'])['status']}', tone: asMap(row['order'])['delivered'] == true ? Tone.success : Tone.info),
                      )
                    : OutlinedButton(
                        onPressed: () async {
                          if (!await confirm(context, 'Reserve this booklet? You pay when you collect it at the center.', ok: 'Reserve')) return;
                          if (!context.mounted) return;
                          final done = await attempt(context, () => Api.post('/student/booklets/${asMap(row['booklet'])['_id']}/reserve', {'method': 'center'}), success: 'Booklet reserved.');
                          if (done != null) await reload();
                        },
                        child: const Text('Reserve'),
                      ),
              ),
            ),
        ]);
      },
    );
  }
}

class WalletScreen extends StatelessWidget {
  const WalletScreen({super.key, required this.teacherId});
  final String teacherId;
  @override
  Widget build(BuildContext context) {
    return LoadView(
      load: () => Api.cached('/student/teachers/$teacherId/transactions'),
      builder: (context, raw, reload) {
        final rows = asList(raw);
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Expanded(child: OutlinedButton.icon(onPressed: () => rechargeDialog(context, reload), icon: const Icon(Icons.redeem), label: const Text('Recharge code'))),
            const SizedBox(width: 10),
            Expanded(
              child: OutlinedButton.icon(
                onPressed: () async {
                  final sent = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => TopupScreen(teacherId: teacherId)));
                  if (sent == true) await reload();
                },
                icon: const Icon(Icons.receipt_long),
                label: const Text('Send a transfer'),
              ),
            ),
          ]),
          const Gap(),
          if (rows.isEmpty) const EmptyState(icon: Icons.receipt_long, title: 'No payments yet'),
          for (final row in rows)
            Card(
              margin: const EdgeInsets.only(bottom: 8),
              child: ListTile(
                title: Text('${row['reason'] ?? row['type']}'),
                subtitle: Text('${dateTime(row['createdAt'])}${row['byName'] != null ? ' · ${row['byName']}' : ''}'),
                trailing: Text(
                  '${(row['amount'] as num) > 0 ? '+' : ''}${money(row['amount'])}',
                  style: TextStyle(fontWeight: FontWeight.w800, color: (row['amount'] as num) >= 0 ? AppColors.success : AppColors.danger),
                ),
              ),
            ),
        ]);
      },
    );
  }
}

class TopupScreen extends StatefulWidget {
  const TopupScreen({super.key, required this.teacherId});
  final String teacherId;
  @override
  State<TopupScreen> createState() => _TopupScreenState();
}

class _TopupScreenState extends State<TopupScreen> {
  final _amount = TextEditingController(), _method = TextEditingController(text: 'Vodafone Cash'), _reference = TextEditingController();
  String? _receipt;
  bool _busy = false;

  Future<void> _pick() async {
    final picked = await FilePicker.pickFiles(type: FileType.image);
    final path = picked.firstOrNull?.path;
    if (path == null || !mounted) return;
    setState(() => _busy = true);
    final url = await attempt(context, () => Api.upload(path));
    if (mounted) setState(() => (_busy = false, _receipt = url ?? _receipt));
  }

  Future<void> _send() async {
    setState(() => _busy = true);
    final done = await attempt(context, () => Api.post('/student/teachers/${widget.teacherId}/topups', {
          'amount': num.tryParse(_amount.text.trim()) ?? 0,
          'method': _method.text.trim(),
          'reference': _reference.text.trim(),
          'receiptUrl': _receipt,
        }), success: 'Sent. Your teacher will review it.');
    if (!mounted) return;
    setState(() => _busy = false);
    if (done != null) Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Send a transfer')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        const Text('Transferred money to your teacher? Send the receipt and it is added to your balance once checked.', style: TextStyle(color: AppColors.muted)),
        const Gap(14),
        TextField(controller: _amount, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Amount (EGP)')),
        const Gap(),
        TextField(controller: _method, decoration: const InputDecoration(labelText: 'How you paid')),
        const Gap(),
        TextField(controller: _reference, decoration: const InputDecoration(labelText: 'Transfer number / reference')),
        const Gap(),
        OutlinedButton.icon(onPressed: _busy ? null : _pick, icon: Icon(_receipt == null ? Icons.add_a_photo : Icons.check_circle), label: Text(_receipt == null ? 'Add the receipt photo' : 'Receipt added')),
        const Gap(20),
        FilledButton(onPressed: _busy || _receipt == null ? null : _send, child: const Text('Send')),
      ]),
    );
  }
}

class LeaderboardScreen extends StatelessWidget {
  const LeaderboardScreen({super.key, required this.teacherId});
  final String teacherId;
  @override
  Widget build(BuildContext context) {
    return LoadView(
      load: () => Api.cached('/student/teachers/$teacherId/leaderboard'),
      builder: (context, raw, _) {
        final rows = asList(raw);
        return Column(children: [
          for (final row in rows)
            Card(
              color: row['isMe'] == true ? AppColors.accentSoft : null,
              margin: const EdgeInsets.only(bottom: 6),
              child: ListTile(
                leading: CircleAvatar(
                  backgroundColor: (row['rank'] as num) <= 3 ? AppColors.accent : AppColors.accentSoft,
                  child: Text('${row['rank']}', style: const TextStyle(color: AppColors.ink, fontWeight: FontWeight.w800)),
                ),
                title: Text('${row['name']}${row['isMe'] == true ? ' (you)' : ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: '${row['centerName'] ?? ''}'.isEmpty ? null : Text('${row['centerName']}'),
                trailing: Text('${row['points']} pts', style: const TextStyle(fontWeight: FontWeight.w800)),
              ),
            ),
        ]);
      },
    );
  }
}

/// The student's teachers and the public directory to join new ones.
class TeachersScreen extends StatefulWidget {
  const TeachersScreen({super.key, required this.onChanged, this.embedded = false});
  final Future<void> Function() onChanged;
  final bool embedded;
  @override
  State<TeachersScreen> createState() => _TeachersScreenState();
}

class _TeachersScreenState extends State<TeachersScreen> {
  List<Map<String, dynamic>> _mine = [];
  List<Map<String, dynamic>> _found = [];
  final _query = TextEditingController();
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final mine = await Api.get('/student/teachers');
      final found = await Api.get('/teachers/search', {'q': _query.text.trim()});
      if (mounted) setState(() => (_mine = asList(mine), _found = asList(found)));
    } catch (error) {
      if (mounted) toast(context, '$error', error: true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String? _statusOf(String id) => _mine.where((entry) => '${entry['teacher']['_id']}' == id).firstOrNull?['status'];

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(16), children: [
        if (widget.embedded)
          const Padding(
            padding: EdgeInsets.only(bottom: 12),
            child: Text('You are not in any class yet. Find your teacher and send a request — you can use the app once they accept.', style: TextStyle(color: AppColors.muted)),
          ),
        if (_mine.isNotEmpty) ...[
          const Text('My teachers', style: TextStyle(fontWeight: FontWeight.w800)),
          const Gap(8),
          for (final entry in _mine)
            Card(
              margin: const EdgeInsets.only(bottom: 8),
              child: ListTile(
                leading: Avatar(fullName(entry['teacher'])),
                title: Text(fullName(entry['teacher'])),
                subtitle: Text((entry['teacher']['subject'] as List? ?? []).join(', ')),
                trailing: entry['status'] == 'active'
                    ? const Pill('Joined', tone: Tone.success)
                    : TextButton(
                        onPressed: () async {
                          final done = await attempt(context, () => Api.delete('/student/teachers/${entry['teacher']['_id']}/request'));
                          if (done != null) {
                            await _load();
                            await widget.onChanged();
                          }
                        },
                        child: const Text('Cancel request'),
                      ),
              ),
            ),
          const Gap(),
        ],
        TextField(
          controller: _query,
          textInputAction: TextInputAction.search,
          onSubmitted: (_) => _load(),
          decoration: InputDecoration(labelText: 'Search teachers', prefixIcon: const Icon(Icons.search), suffixIcon: IconButton(icon: const Icon(Icons.arrow_forward), onPressed: _load)),
        ),
        const Gap(),
        for (final teacher in _found)
          Card(
            margin: const EdgeInsets.only(bottom: 8),
            child: ListTile(
              leading: Avatar(fullName(teacher)),
              title: Text(fullName(teacher), style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text([
                (teacher['subject'] as List? ?? []).join(', '),
                if ((teacher['centers'] as List? ?? []).isNotEmpty) (teacher['centers'] as List).join(', '),
              ].where((part) => part.isNotEmpty).join(' · ')),
              trailing: switch (_statusOf('${teacher['_id']}')) {
                'active' => const Pill('Joined', tone: Tone.success),
                'pending' => const Pill('Requested', tone: Tone.warn),
                _ => TextButton(
                    onPressed: () async {
                      final done = await attempt(context, () => Api.post('/student/teachers/${teacher['_id']}/request'), success: 'Request sent.');
                      if (done != null) {
                        await _load();
                        await widget.onChanged();
                      }
                    },
                    child: const Text('Join'),
                  ),
              },
            ),
          ),
      ]),
    );
  }
}
