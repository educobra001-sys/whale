import 'package:flutter/material.dart';

import '../services/account.dart';
import '../services/api.dart';
import '../services/outbox.dart';
import '../services/server.dart';
import '../services/session.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'login_screen.dart';
import 'parent/parent_shell.dart';
import 'place/place_shell.dart';
import 'staff/staff_shell.dart';
import 'student/student_shell.dart';

/// Loads the signed-in account and opens its portal.
class HomeRouter extends StatefulWidget {
  const HomeRouter({super.key});
  @override
  State<HomeRouter> createState() => _HomeRouterState();
}

class _HomeRouterState extends State<HomeRouter> {
  Account? _account;
  ApiError? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final account = await Account.load();
      if (mounted) setState(() => _account = account);
    } on ApiError catch (error) {
      if (!mounted) return;
      if (error.status == 401 || error.status == 403) {
        await signOut(context, message: error.message);
        return;
      }
      setState(() => _error = error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final account = _account;
    if (account != null) {
      return switch (account.role) {
        Role.student => StudentShell(account: account),
        Role.parent => ParentShell(account: account),
        Role.teacher || Role.assistant => StaffShell(account: account),
        Role.center || Role.school => PlaceShell(account: account),
      };
    }
    return Scaffold(
      body: _error == null
          ? const Center(child: CircularProgressIndicator())
          : EmptyState(
              icon: Icons.cloud_off_outlined,
              title: _error!.offline ? 'No connection to the server' : 'Could not open your account',
              text: _error!.message,
              action: Column(children: [
                FilledButton(style: FilledButton.styleFrom(minimumSize: const Size(180, 48)), onPressed: _load, child: const Text('Try again')),
                TextButton(onPressed: () => signOut(context), child: const Text('Sign out')),
              ]),
            ),
    );
  }
}

Future<void> signOut(BuildContext context, {String? message}) async {
  await Session.clear();
  await Api.clearCache();
  if (!context.mounted) return;
  Navigator.of(context).pushAndRemoveUntil(MaterialPageRoute(builder: (_) => const LoginScreen()), (_) => false);
  if (message != null) toast(context, message, error: true);
}

/// Account details, password change, server and sign-out. Shared by every role.
class AccountScreen extends StatelessWidget {
  const AccountScreen({super.key, required this.account, this.extra = const []});
  final Account account;
  final List<Widget> extra;

  @override
  Widget build(BuildContext context) {
    final p = account.profile;
    return ListView(padding: const EdgeInsets.all(16), children: [
      SectionCard(
        child: Row(children: [
          Avatar(account.name, size: 54),
          const SizedBox(width: 14),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(account.name, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
              Text(account.role.label, style: const TextStyle(color: AppColors.muted)),
            ]),
          ),
        ]),
      ),
      const Gap(),
      SectionCard(
        title: 'Details',
        child: Column(children: [
          if (p['userID'] != null) InfoRow('Student code', '${p['userID']}'),
          if (p['userName'] != null) InfoRow('Username', '${p['userName']}'),
          if (p['email'] != null) InfoRow('Email', '${p['email']}'),
          if (p['phone'] != null) InfoRow('Phone', '${p['phone']}'),
          if (p['parentPhone'] != null) InfoRow('Parent phone', '${p['parentPhone']}'),
          if ('${p['grade'] ?? ''}'.isNotEmpty) InfoRow('Grade', gradeLabel(p['grade'])),
          if (p['textlocation'] != null) InfoRow('Address', '${p['textlocation']}'),
          if (p['referralId'] != null) InfoRow('Marketing ID', '${p['referralId']}'),
          InfoRow('Server', Server.url),
        ]),
      ),
      if (account.role == Role.parent || account.role == Role.student) ...[const Gap(), const TelegramCard()],
      ...extra,
      const Gap(),
      OutlinedButton.icon(onPressed: () => _changePassword(context), icon: const Icon(Icons.lock_reset), label: const Text('Change password')),
      const Gap(10),
      ValueListenableBuilder(
        valueListenable: Outbox.items,
        builder: (context, items, _) => OutlinedButton.icon(
          style: OutlinedButton.styleFrom(foregroundColor: AppColors.danger),
          onPressed: () async {
            if (items.isNotEmpty && !await confirm(context, '${items.length} offline check-in(s) haven\'t been sent yet. Signing out keeps them on this phone for this account. Sign out?', ok: 'Sign out')) return;
            if (context.mounted) await signOut(context);
          },
          icon: const Icon(Icons.logout),
          label: const Text('Sign out'),
        ),
      ),
    ]);
  }

  Future<void> _changePassword(BuildContext context) async {
    final current = TextEditingController(), next = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Change password'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: current, obscureText: true, decoration: const InputDecoration(labelText: 'Current password')),
          const Gap(),
          TextField(controller: next, obscureText: true, decoration: const InputDecoration(labelText: 'New password (8+ characters)')),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Save')),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    final done = await attempt(context, () => Api.patch('/${account.role.name}/password', {'currentPassword': current.text, 'newPassword': next.text}));
    if (done != null && context.mounted) await signOut(context, message: 'Password changed. Please sign in with the new one.');
  }
}


/// Attendance and other messages can arrive on Telegram. Opening the bot and sharing the phone number links it;
/// the per-child button links that child directly.
class TelegramCard extends StatefulWidget {
  const TelegramCard({super.key});
  @override
  State<TelegramCard> createState() => _TelegramCardState();
}

class _TelegramCardState extends State<TelegramCard> {
  List<Map<String, dynamic>>? _rows;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final rows = asList(await Api.get('/me/telegram'));
      if (mounted) setState(() => _rows = rows);
    } catch (_) {
      if (mounted) setState(() => _rows = const []);
    }
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rows;
    // Hidden until the owner has connected a bot (the links are empty then).
    if (rows == null || rows.isEmpty || rows.every((row) => '${row['url'] ?? ''}'.isEmpty)) return const SizedBox.shrink();
    return SectionCard(
      title: 'Messages on Telegram',
      trailing: IconButton(onPressed: _load, icon: const Icon(Icons.refresh, size: 20), tooltip: 'Check again'),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Text('Get attendance, absence and news from the teachers on Telegram. Open the bot, then press "Share my phone number".', style: TextStyle(color: AppColors.muted, fontSize: 13)),
        const Gap(10),
        for (final row in rows)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(children: [
              Icon(row['linked'] == true ? Icons.check_circle : Icons.telegram, color: row['linked'] == true ? AppColors.success : AppColors.info),
              const SizedBox(width: 10),
              Expanded(child: Text(fullName(asMap(row['student'])), style: const TextStyle(fontWeight: FontWeight.w600))),
              row['linked'] == true
                  ? const Pill('Linked', tone: Tone.success)
                  : TextButton(onPressed: () => openLink('${row['url']}'), child: const Text('Open bot')),
            ]),
          ),
      ]),
    );
  }
}
