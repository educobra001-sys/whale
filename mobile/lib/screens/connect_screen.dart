import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../services/server.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'login_screen.dart';

/// First screen: which computer runs EduCobra. On the computer, start-lan.bat prints the address and a
/// QR code to scan here.
class ConnectScreen extends StatefulWidget {
  const ConnectScreen({super.key, this.canGoBack = false});
  final bool canGoBack;

  @override
  State<ConnectScreen> createState() => _ConnectScreenState();
}

class _ConnectScreenState extends State<ConnectScreen> {
  late final _address = TextEditingController(text: Server.url.replaceFirst(RegExp(r'^http://'), ''));
  bool _busy = false;
  String? _error;

  Future<void> _connect([String? value]) async {
    setState(() => (_busy = true, _error = null));
    try {
      final base = await Server.verify(value ?? _address.text);
      await Server.save(base);
      if (!mounted) return;
      Navigator.of(context).pushAndRemoveUntil(MaterialPageRoute(builder: (_) => const LoginScreen()), (_) => false);
    } on FormatException catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _scan() async {
    final code = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => const _QrPage()));
    if (code != null && mounted) {
      _address.text = Server.normalize(code).replaceFirst(RegExp(r'^http://'), '');
      await _connect(code);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: widget.canGoBack ? AppBar(title: const Text('Server')) : null,
      body: SafeArea(
        child: ListView(padding: const EdgeInsets.all(24), children: [
          if (!widget.canGoBack) const SizedBox(height: 40),
          const Icon(Icons.school_rounded, size: 64, color: AppColors.accentDeep),
          const Gap(12),
          const Text('EduCobra', textAlign: TextAlign.center, style: TextStyle(fontSize: 30, fontWeight: FontWeight.w900, color: AppColors.ink)),
          const Gap(6),
          const Text(
            'Connect to the computer running EduCobra.\nOn that computer, open start-lan.bat — it shows the address and a QR code.',
            textAlign: TextAlign.center,
            style: TextStyle(color: AppColors.muted),
          ),
          const Gap(28),
          FilledButton.icon(onPressed: _busy ? null : _scan, icon: const Icon(Icons.qr_code_scanner), label: const Text('Scan the QR code')),
          const Gap(20),
          const Text('Or type the address', style: TextStyle(fontWeight: FontWeight.w700)),
          const Gap(8),
          TextField(
            controller: _address,
            keyboardType: TextInputType.url,
            autocorrect: false,
            decoration: const InputDecoration(hintText: '192.168.1.20:4000', prefixIcon: Icon(Icons.computer)),
            onSubmitted: (_) => _connect(),
          ),
          if (_error != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(_error!, style: const TextStyle(color: AppColors.danger))),
          const Gap(14),
          OutlinedButton(onPressed: _busy ? null : () => _connect(), child: _busy ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Connect')),
          const Gap(24),
          const Text(
            'The phone and the computer must be on the same Wi-Fi. A temporary public link (https://….trycloudflare.com) from start-public.bat works too.',
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
