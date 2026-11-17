import 'package:flutter/material.dart';

import '../../services/account.dart';
import '../../services/api.dart';
import '../../services/outbox.dart';
import '../../theme.dart';
import '../../widgets/common.dart';
import '../home_router.dart';
import 'scan_screen.dart';
import 'staff_more.dart';
import 'staff_sessions.dart';
import 'staff_students.dart';

class _Tab {
  const _Tab(this.label, this.icon, this.build);
  final String label;
  final IconData icon;
  final Widget Function(bool visible) build;
}

/// Teachers and assistants. Each tab appears only when the plan includes the section and, for an
/// assistant, when the teacher gave that permission — the same rules as the website.
class StaffShell extends StatefulWidget {
  const StaffShell({super.key, required this.account});
  final Account account;
  @override
  State<StaffShell> createState() => _StaffShellState();
}

class _StaffShellState extends State<StaffShell> {
  int _tab = 0;
  final _visited = <int>{0};
  late final List<_Tab> _tabs = _buildTabs();

  List<_Tab> _buildTabs() {
    final a = widget.account;
    return [
      if (a.can('dashboard')) _Tab('Home', Icons.dashboard_outlined, (_) => StaffDashboard(account: a)),
      if (a.has('scan') && a.canAny(['scan_attendance', 'scan_homework', 'door_check'])) _Tab('Scan', Icons.qr_code_scanner, (visible) => ScanScreen(account: a, visible: visible)),
      if (a.has('students') && a.can('students_view')) _Tab('Students', Icons.people_outline, (_) => StudentsScreen(account: a)),
      if (a.has('sessions') && a.can('sessions_view')) _Tab('Sessions', Icons.event_note_outlined, (_) => SessionsScreen(account: a)),
      _Tab('More', Icons.more_horiz, (_) => StaffMore(account: a)),
    ];
  }

  @override
  void initState() {
    super.initState();
    Outbox.flush();
  }

  @override
  Widget build(BuildContext context) {
    final tab = _tabs[_tab];
    return Scaffold(
      appBar: AppBar(
        title: Text(tab.label == 'Home' ? widget.account.name : tab.label),
        actions: const [OutboxButton()],
      ),
      // Tabs are built the first time they are opened; the scanner knows when it is on screen.
      body: IndexedStack(index: _tab, children: [for (var i = 0; i < _tabs.length; i++) _visited.contains(i) ? _tabs[i].build(i == _tab) : const SizedBox()]),
      bottomNavigationBar: _tabs.length < 2
          ? null
          : NavigationBar(
              selectedIndex: _tab,
              onDestinationSelected: (index) => setState(() => (_tab = index, _visited.add(index))),
              destinations: [for (final t in _tabs) NavigationDestination(icon: Icon(t.icon), label: t.label)],
            ),
    );
  }
}

/// Cloud icon with the number of check-ins still waiting to be sent.
class OutboxButton extends StatelessWidget {
  const OutboxButton({super.key});
  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder2(
      first: Outbox.items,
      second: Connection.online,
      builder: (context, items, online) {
        final problems = items.where((item) => item.error != null).length;
        if (items.isEmpty && online) return const SizedBox.shrink();
        return IconButton(
          tooltip: 'Offline check-ins',
          onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const OutboxScreen())),
          icon: Badge(
            isLabelVisible: items.isNotEmpty,
            backgroundColor: problems > 0 ? AppColors.danger : AppColors.accentDeep,
            label: Text('${items.length}'),
            child: Icon(online ? Icons.cloud_upload_outlined : Icons.cloud_off, color: online ? AppColors.ink : AppColors.warn),
          ),
        );
      },
    );
  }
}

class ValueListenableBuilder2<A, B> extends StatelessWidget {
  const ValueListenableBuilder2({super.key, required this.first, required this.second, required this.builder});
  final ValueNotifier<A> first;
  final ValueNotifier<B> second;
  final Widget Function(BuildContext context, A a, B b) builder;
  @override
  Widget build(BuildContext context) => ValueListenableBuilder<A>(
        valueListenable: first,
        builder: (context, a, _) => ValueListenableBuilder<B>(valueListenable: second, builder: (context, b, _) => builder(context, a, b)),
      );
}

class OutboxScreen extends StatelessWidget {
  const OutboxScreen({super.key});
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Offline check-ins')),
      body: ValueListenableBuilder(
        valueListenable: Outbox.items,
        builder: (context, items, _) => ListView(padding: const EdgeInsets.all(16), children: [
          const Text('Check-ins made with no connection. They are sent automatically when the connection returns, recorded at the time they were scanned.', style: TextStyle(color: AppColors.muted)),
          const Gap(),
          FilledButton.icon(
            onPressed: () async {
              final sent = await Outbox.flush();
              if (context.mounted) toast(context, sent > 0 ? '$sent check-in(s) sent.' : (Connection.online.value ? 'Nothing more to send.' : 'Still no connection.'));
            },
            icon: const Icon(Icons.sync),
            label: const Text('Send now'),
          ),
          const Gap(),
          if (items.isEmpty) const EmptyState(icon: Icons.cloud_done_outlined, title: 'Everything is sent'),
          for (final item in items)
            Card(
              margin: const EdgeInsets.only(bottom: 8),
              color: item.error != null ? AppColors.dangerSoft : null,
              child: ListTile(
                title: Text(item.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text(item.error ?? 'Waiting · ${dateTime(item.at.toIso8601String())}${(item.body['payment'] ?? 0) > 0 ? ' · paid ${money(item.body['payment'])}' : ''}'),
                trailing: IconButton(
                  icon: const Icon(Icons.delete_outline),
                  onPressed: () async {
                    if (await confirm(context, 'Remove this check-in? It will not be recorded.', ok: 'Remove', danger: true)) await Outbox.remove(item.id);
                  },
                ),
              ),
            ),
        ]),
      ),
    );
  }
}

class StaffDashboard extends StatelessWidget {
  const StaffDashboard({super.key, required this.account});
  final Account account;
  @override
  Widget build(BuildContext context) {
    return LoadView(
      load: () => Api.cached('/teacher/dashboard'),
      builder: (context, raw, _) {
        final data = asMap(raw);
        final counts = asMap(data['counts']);
        final active = asMap(data['activeSession']);
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          if (account.role.name == 'assistant')
            Padding(padding: const EdgeInsets.only(bottom: 10), child: Text('Assistant · ${fullName(account.profile['teacher'])}', style: const TextStyle(color: AppColors.muted))),
          if (active.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: SectionCard(
                color: AppColors.successSoft,
                title: 'Live session',
                child: Text('Week ${active['week']} · #${active['number']} — ${active['sequence']}\n${active['presentCount'] ?? 0} present', style: const TextStyle(fontWeight: FontWeight.w600)),
              ),
            ),
          StatGrid(children: [
            StatTile(label: 'Students', value: '${counts['students'] ?? 0}', icon: Icons.people_outline),
            StatTile(label: 'Total balance', value: money(data['totalBalance']), icon: Icons.account_balance_wallet_outlined, accent: true),
            StatTile(label: 'Join requests', value: '${counts['pendingRequests'] ?? 0}', icon: Icons.person_add_alt),
            StatTile(label: 'Homework to grade', value: '${counts['pendingSubmissions'] ?? 0}', icon: Icons.edit_note),
            StatTile(label: 'Low balance', value: '${counts['lowBalance'] ?? 0}', icon: Icons.warning_amber),
            StatTile(label: 'Blocked', value: '${counts['blocked'] ?? 0}', icon: Icons.block),
          ]),
          SectionCard(
            title: "Today's groups",
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              if (asList(data['todaySlots']).isEmpty) const Text('No groups today.', style: TextStyle(color: AppColors.muted)),
              for (final slot in asList(data['todaySlots']))
                InfoRow('${slot['startTime']}', '${slot['title']}${'${slot['centerName'] ?? ''}'.isNotEmpty ? ' · ${slot['centerName']}' : ''}'),
            ]),
          ),
          const Gap(),
          SectionCard(
            title: 'Recent attendance',
            child: Column(children: [
              for (final point in asList(data['attendanceTrend']))
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 3),
                  child: Row(children: [
                    SizedBox(width: 40, child: Text('${point['label']}', style: const TextStyle(color: AppColors.muted))),
                    Expanded(
                      child: LinearProgressIndicator(
                        value: (counts['students'] ?? 0) == 0 ? 0 : ((point['value'] as num) / (counts['students'] as num)).clamp(0, 1).toDouble(),
                        minHeight: 10,
                        borderRadius: BorderRadius.circular(9),
                        color: AppColors.accent,
                        backgroundColor: AppColors.accentSoft,
                      ),
                    ),
                    SizedBox(width: 40, child: Text('${point['value']}', textAlign: TextAlign.end)),
                  ]),
                ),
            ]),
          ),
          if (asList(data['lowBalanceStudents']).isNotEmpty) ...[
            const Gap(),
            SectionCard(
              title: 'Low balance',
              child: Column(children: [for (final s in asList(data['lowBalanceStudents'])) InfoRow(fullName(s), money(s['balance']), valueColor: AppColors.danger)]),
            ),
          ],
          const Gap(),
          OutlinedButton.icon(
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => Scaffold(appBar: AppBar(title: const Text('Account')), body: AccountScreen(account: account)))),
            icon: const Icon(Icons.person_outline),
            label: const Text('My account'),
          ),
        ]);
      },
    );
  }
}
