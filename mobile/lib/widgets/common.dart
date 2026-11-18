import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../services/api.dart';
import '../theme.dart';

// ---------- formatting ----------
final _money = NumberFormat.decimalPattern('en');
String money(dynamic value) => '${_money.format(num.tryParse('$value') ?? 0)} EGP';

DateTime? parseDate(dynamic value) => value == null ? null : DateTime.tryParse('$value')?.toLocal();
String date(dynamic value) {
  final d = parseDate(value);
  return d == null ? '—' : DateFormat('d MMM yyyy').format(d);
}

String dateTime(dynamic value) {
  final d = parseDate(value);
  return d == null ? '—' : DateFormat('d MMM yyyy · HH:mm').format(d);
}

String fullName(dynamic person) {
  if (person is! Map) return '—';
  final name = '${person['firstName'] ?? ''} ${person['lastName'] ?? ''}'.trim();
  return name.isNotEmpty ? name : '${person['name'] ?? person['userName'] ?? '—'}';
}

const grades = ['Secondary 1', 'Secondary 2', 'Secondary 3'];
String gradeLabel(dynamic value) {
  final index = int.tryParse('$value');
  return index != null && index >= 0 && index < grades.length ? grades[index] : '';
}

const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

String duration(dynamic seconds) {
  final total = (num.tryParse('$seconds') ?? 0).round();
  if (total <= 0) return '';
  final h = total ~/ 3600, m = (total % 3600) ~/ 60;
  return h > 0 ? '${h}h ${m}m' : '${m}m';
}

List<Map<String, dynamic>> asList(dynamic value) => [for (final item in (value as List? ?? const [])) if (item is Map) Map<String, dynamic>.from(item)];
Map<String, dynamic> asMap(dynamic value) => value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};

// ---------- feedback ----------
void toast(BuildContext context, String message, {bool error = false}) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message), backgroundColor: error ? AppColors.danger : AppColors.ink));
}

Future<bool> confirm(BuildContext context, String message, {String ok = 'Yes', bool danger = false}) async {
  final answer = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      content: Text(message),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
        FilledButton(
          style: FilledButton.styleFrom(minimumSize: const Size(90, 44), backgroundColor: danger ? AppColors.danger : AppColors.accent, foregroundColor: danger ? Colors.white : AppColors.ink),
          onPressed: () => Navigator.pop(context, true),
          child: Text(ok),
        ),
      ],
    ),
  );
  return answer ?? false;
}

/// Runs an action and shows its error, if any. Returns null when it failed.
Future<T?> attempt<T>(BuildContext context, Future<T> Function() action, {String? success}) async {
  try {
    final result = await action();
    if (success != null && context.mounted) toast(context, success);
    return result;
  } on ApiError catch (error) {
    if (context.mounted) toast(context, error.message, error: true);
  } catch (error) {
    if (context.mounted) toast(context, '$error', error: true);
  }
  return null;
}

Future<void> openLink(String url) async {
  final uri = Uri.tryParse(url);
  if (uri != null) await launchUrl(uri, mode: LaunchMode.externalApplication);
}

// ---------- loading a screen ----------
/// Loads data, shows a spinner, the error with a retry button, and a yellow bar when the data is the
/// copy saved on the phone. Pull down to refresh.
class LoadView extends StatefulWidget {
  const LoadView({super.key, required this.load, required this.builder, this.scroll = true});

  final Future<Loaded<dynamic>> Function() load;
  final Widget Function(BuildContext context, dynamic data, Future<void> Function() reload) builder;

  /// false when the builder brings its own scrolling list.
  final bool scroll;

  @override
  State<LoadView> createState() => _LoadViewState();
}

class _LoadViewState extends State<LoadView> {
  Loaded<dynamic>? _loaded;
  Object? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    setState(() => _loading = _loaded == null);
    try {
      final loaded = await widget.load();
      if (mounted) setState(() => (_loaded = loaded, _error = null));
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _loaded == null) return const WakingSpinner();
    if (_loaded == null) {
      return EmptyState(
        icon: Icons.cloud_off_outlined,
        title: 'Could not load this page',
        text: '${_error ?? ''}',
        action: OutlinedButton.icon(onPressed: _reload, icon: const Icon(Icons.refresh), label: const Text('Try again')),
      );
    }
    final body = widget.builder(context, _loaded!.data, _reload);
    final content = widget.scroll ? ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: [body]) : body;
    return Column(children: [
      if (_loaded!.fromCache)
        Container(
          width: double.infinity,
          color: AppColors.warnSoft,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Text('No connection — showing the copy saved ${dateTime(_loaded!.savedAt?.toIso8601String())}.', style: const TextStyle(color: AppColors.warn, fontSize: 13)),
        ),
      Expanded(child: RefreshIndicator(onRefresh: _reload, child: content)),
    ]);
  }
}

/// A spinner that explains itself when the online server takes a while to wake up.
class WakingSpinner extends StatelessWidget {
  const WakingSpinner({super.key});
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        const CircularProgressIndicator(),
        ValueListenableBuilder<bool>(
          valueListenable: Api.waking,
          builder: (context, waking, _) => AnimatedOpacity(
            opacity: waking ? 1 : 0,
            duration: const Duration(milliseconds: 300),
            child: const Padding(
              padding: EdgeInsets.only(top: 14),
              child: Text('Waking up the server…\nThe first visit after a quiet while takes a few seconds.', textAlign: TextAlign.center, style: TextStyle(color: AppColors.muted, fontSize: 13)),
            ),
          ),
        ),
      ]),
    );
  }
}

// ---------- building blocks ----------
class SectionCard extends StatelessWidget {
  const SectionCard({super.key, this.title, this.trailing, required this.child, this.padding = const EdgeInsets.all(16), this.color});
  final String? title;
  final Widget? trailing;
  final Widget child;
  final EdgeInsets padding;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: color,
      child: Padding(
        padding: padding,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          if (title != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Row(children: [
                Expanded(child: Text(title!, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: AppColors.ink))),
                ?trailing,
              ]),
            ),
          child,
        ]),
      ),
    );
  }
}

class Gap extends StatelessWidget {
  const Gap([this.size = 12, Key? key]) : super(key: key);
  final double size;
  @override
  Widget build(BuildContext context) => SizedBox(height: size, width: size);
}

class StatTile extends StatelessWidget {
  const StatTile({super.key, required this.label, required this.value, this.icon, this.accent = false, this.hint});
  final String label;
  final String value;
  final IconData? icon;
  final bool accent;
  final String? hint;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: accent ? AppColors.accentSoft : null,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            if (icon != null) Icon(icon, size: 16, color: AppColors.accentText),
            if (icon != null) const SizedBox(width: 6),
            Expanded(child: Text(label, style: const TextStyle(color: AppColors.muted, fontSize: 12.5), overflow: TextOverflow.ellipsis)),
          ]),
          const SizedBox(height: 6),
          Text(value, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: AppColors.ink)),
          if (hint != null && hint!.isNotEmpty) Text(hint!, style: const TextStyle(color: AppColors.muted, fontSize: 12)),
        ]),
      ),
    );
  }
}

/// Two tiles per row.
class StatGrid extends StatelessWidget {
  const StatGrid({super.key, required this.children});
  final List<Widget> children;
  @override
  Widget build(BuildContext context) {
    final rows = <Widget>[];
    for (var i = 0; i < children.length; i += 2) {
      rows.add(Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: IntrinsicHeight(
          child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Expanded(child: children[i]),
            const SizedBox(width: 10),
            Expanded(child: i + 1 < children.length ? children[i + 1] : const SizedBox()),
          ]),
        ),
      ));
    }
    return Column(children: rows);
  }
}

enum Tone { success, warn, danger, info, muted, accent }

class Pill extends StatelessWidget {
  const Pill(this.text, {super.key, this.tone = Tone.muted});
  final String text;
  final Tone tone;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (tone) {
      Tone.success => (AppColors.successSoft, AppColors.success),
      Tone.warn => (AppColors.warnSoft, AppColors.warn),
      Tone.danger => (AppColors.dangerSoft, AppColors.danger),
      Tone.info => (AppColors.infoSoft, AppColors.info),
      Tone.accent => (AppColors.accentSoft, AppColors.accentText),
      Tone.muted => (const Color(0xFFF1EDE4), AppColors.muted),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(99)),
      child: Text(text, style: TextStyle(color: fg, fontSize: 12, fontWeight: FontWeight.w700)),
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.title, this.text = '', this.icon = Icons.inbox_outlined, this.action});
  final String title;
  final String text;
  final IconData icon;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 44, color: AppColors.accentDeep),
          const SizedBox(height: 10),
          Text(title, textAlign: TextAlign.center, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: AppColors.ink)),
          if (text.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Text(text, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.muted))),
          if (action != null) Padding(padding: const EdgeInsets.only(top: 14), child: action),
        ]),
      ),
    );
  }
}

class Avatar extends StatelessWidget {
  const Avatar(this.name, {super.key, this.size = 40});
  final String name;
  final double size;
  @override
  Widget build(BuildContext context) {
    final letters = name.trim().split(RegExp(r'\s+')).where((part) => part.isNotEmpty).take(2).map((part) => part[0].toUpperCase()).join();
    return CircleAvatar(
      radius: size / 2,
      backgroundColor: AppColors.accentSoft,
      child: Text(letters.isEmpty ? '?' : letters, style: TextStyle(color: AppColors.accentText, fontWeight: FontWeight.w800, fontSize: size * 0.36)),
    );
  }
}

/// A key/value line inside a card.
class InfoRow extends StatelessWidget {
  const InfoRow(this.label, this.value, {super.key, this.valueColor});
  final String label;
  final String value;
  final Color? valueColor;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(width: 120, child: Text(label, style: const TextStyle(color: AppColors.muted))),
          Expanded(child: Text(value, style: TextStyle(fontWeight: FontWeight.w600, color: valueColor ?? AppColors.ink))),
        ]),
      );
}

/// Shows a data: URL image (the QR codes the server draws).
class DataImage extends StatelessWidget {
  const DataImage(this.dataUrl, {super.key, this.size = 220});
  final String dataUrl;
  final double size;
  @override
  Widget build(BuildContext context) {
    final comma = dataUrl.indexOf(',');
    if (comma < 0) return SizedBox(width: size, height: size);
    return Image.memory(base64Decode(dataUrl.substring(comma + 1)), width: size, height: size, gaplessPlayback: true, filterQuality: FilterQuality.none);
  }
}

String homeworkLabel(dynamic status) => switch ('$status') {
      'complete' => 'Complete',
      'incomplete' => 'Incomplete',
      'no_steps' => 'No steps',
      'not_done' => 'Not done',
      'submitted' => 'Submitted',
      _ => '',
    };

Tone homeworkTone(dynamic status) => switch ('$status') {
      'complete' => Tone.success,
      'incomplete' || 'no_steps' => Tone.warn,
      'not_done' => Tone.danger,
      _ => Tone.info,
    };
