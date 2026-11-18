import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../services/server.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'login_screen.dart';

/// Which EduCobra server the app talks to: the online one (Vercel) or, for testing, a computer on the Wi-Fi.
class ConnectScreen extends StatefulWidget {
  const ConnectScreen({super.key, this.canGoBack = false});
  final bool canGoBack;

  @override
  State<ConnectScreen> createState() => _ConnectScreenState();
}

class _ConnectScreenState extends State<ConnectScreen> {
  late final _address = TextEditingController(text: Server.url.replaceFirst(RegExp(r'^https?://'), ''));
  bool _busy = false;
  String? _busyFor;
  String? _error;

  Future<void> _connect([String? value]) async {
    final target = value ?? _address.text;
    setState(() => (_busy = true, _busyFor = target, _error = null));
    try {
      final base = await Server.verify(target);
      await Server.save(base);
      if (!mounted) return;
      Navigator.of(context).pushAndRemoveUntil(MaterialPageRoute(builder: (_) => const LoginScreen()), (_) => false);
    } on FormatException catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => (_busy = false, _busyFor = null));
    }
  }

  Future<void> _scan() async {
    final code = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => const _QrPage()));
    if (code != null && mounted) {
      _address.text = Server.normalize(code).replaceFirst(RegExp(r'^https?://'), '');
      await _connect(code);
    }
  }

  Widget _spinner() => const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2));

  @override
  Widget build(BuildContext context) {
    final online = Server.onlineDefault;
    final recent = Server.recent.where((item) => item != online).toList();
    return Scaffold(
      appBar: widget.canGoBack ? AppBar(title: const Text('Server')) : null,
      body: SafeArea(
        child: ListView(padding: const EdgeInsets.fromLTRB(22, 16, 22, 32), children: [
          if (!widget.canGoBack) const SizedBox(height: 32),
          Center(
            child: Container(
              padding: const EdgeInsets.all(18),
              decoration: const BoxDecoration(color: AppColors.accentSoft, shape: BoxShape.circle),
              child: const Icon(Icons.school_rounded, size: 52, color: AppColors.accentDeep),
            ),
          ),
          const Gap(14),
          const Text('EduCobra', textAlign: TextAlign.center, style: TextStyle(fontSize: 30, fontWeight: FontWeight.w900, color: AppColors.ink)),
          const Gap(6),
          const Text('Choose where your classes are.', textAlign: TextAlign.center, style: TextStyle(color: AppColors.muted)),
          const Gap(24),
          if (online.isNotEmpty) ...[
            SectionCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                const Row(children: [
                  Icon(Icons.cloud_done_outlined, color: AppColors.success),
                  SizedBox(width: 8),
                  Text('Online', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                ]),
                const Gap(4),
                Text(Uri.parse(online).authority, style: const TextStyle(color: AppColors.muted)),
                const Gap(12),
                FilledButton.icon(
                  onPressed: _busy ? null : () => _connect(online),
                  icon: _busyFor == online ? _spinner() : const Icon(Icons.arrow_forward),
                  label: const Text('Use the online server'),
                ),
              ]),
            ),
            const Gap(20),
            const Row(children: [
              Expanded(child: Divider()),
              Padding(padding: EdgeInsets.symmetric(horizontal: 10), child: Text('or another server', style: TextStyle(color: AppColors.muted, fontSize: 12.5))),
              Expanded(child: Divider()),
            ]),
            const Gap(16),
          ],
          TextField(
            controller: _address,
            keyboardType: TextInputType.url,
            autocorrect: false,
            textInputAction: TextInputAction.go,
            decoration: const InputDecoration(
              labelText: 'Server address',
              hintText: 'your-app.vercel.app or 192.168.1.20:4000',
              prefixIcon: Icon(Icons.dns_outlined),
            ),
            onSubmitted: (_) => _connect(),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: SectionCard(color: AppColors.dangerSoft, padding: const EdgeInsets.all(12), child: Text(_error!, style: const TextStyle(color: AppColors.danger))),
            ),
          const Gap(12),
          Row(children: [
            Expanded(
              child: online.isEmpty
                  ? FilledButton(onPressed: _busy ? null : () => _connect(), child: _busy && _busyFor == _address.text ? _spinner() : const Text('Connect'))
                  : OutlinedButton(onPressed: _busy ? null : () => _connect(), child: _busy && _busyFor == _address.text ? _spinner() : const Text('Connect')),
            ),
            const SizedBox(width: 10),
            OutlinedButton.icon(onPressed: _busy ? null : _scan, icon: const Icon(Icons.qr_code_scanner), label: const Text('Scan')),
          ]),
          if (recent.isNotEmpty) ...[
            const Gap(20),
            const Text('Recent', style: TextStyle(fontWeight: FontWeight.w700)),
            const Gap(6),
            for (final item in recent)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(item.startsWith('https://') ? Icons.cloud_outlined : Icons.wifi, color: AppColors.muted),
                title: Text(Uri.tryParse(item)?.authority ?? item),
                trailing: _busyFor == item ? _spinner() : const Icon(Icons.chevron_right),
                onTap: _busy ? null : () => _connect(item),
              ),
          ],
          const Gap(20),
          const Text(
            'Online: type the link of your EduCobra site, for example your-app.vercel.app.\n'
            'On a computer at home or in the center: open start-lan.bat there and scan its QR code, with the phone on the same Wi-Fi.',
            textAlign: TextAlign.center,
            style: TextStyle(color: AppColors.muted, fontSize: 12.5),
          ),
        ]),
      ),
    );
  }
}

class _QrPage extends StatefulWidget {
  const _QrPage();
  @override
  State<_QrPage> createState() => _QrPageState();
}

class _QrPageState extends State<_QrPage> {
  bool _done = false;
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Scan the server QR')),
      body: MobileScanner(
        onDetect: (capture) {
          final value = capture.barcodes.firstOrNull?.rawValue;
          if (_done || value == null || value.isEmpty) return;
          _done = true;
          Navigator.of(context).pop(value);
        },
      ),
    );
  }
}
