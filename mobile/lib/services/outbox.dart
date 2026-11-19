import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'session.dart';

/// Work done on this phone while the server couldn't be reached: a check-in, a homework mark or cash added
/// to a check-in. Each has a fixed id, and is sent in the order it was made, at the time it was made.
class QueuedOp {
  QueuedOp({required this.id, required this.kind, required this.sessionId, required this.body, required this.name, required this.at, this.error});

  final String id;

  /// attendance | homework | payment
  final String kind;
  final String sessionId;
  final Map<String, dynamic> body;
  final String name;
  final DateTime at;

  /// Set when the server refused it, so a person can look at it, retry or remove it.
  String? error;

  String get label => switch (kind) {
        'homework' => 'Homework · $name',
        'payment' => 'Cash · $name',
        _ => 'Check-in · $name',
      };

  Map<String, dynamic> toJson() => {'id': id, 'kind': kind, 'sessionId': sessionId, 'body': body, 'name': name, 'at': at.toIso8601String(), 'error': error};

  static QueuedOp fromJson(Map<String, dynamic> json) => QueuedOp(
        id: '${json['id']}',
        kind: '${json['kind'] ?? 'attendance'}',
        sessionId: '${json['sessionId']}',
        body: Map<String, dynamic>.from(json['body'] as Map),
        name: '${json['name'] ?? ''}',
        at: DateTime.tryParse('${json['at'] ?? ''}') ?? DateTime.now(),
        error: json['error'] as String?,
      );
}

/// Student codes as people type them: "123", "stu123", Arabic digits → "STU-000123" (same as the server).
String normalizeStudentCode(String input) {
  var text = input.trim().toUpperCase();
  text = text.replaceAllMapped(RegExp('[٠-٩]'), (m) => '${m[0]!.codeUnitAt(0) - 0x0660}');
  text = text.replaceAllMapped(RegExp('[۰-۹]'), (m) => '${m[0]!.codeUnitAt(0) - 0x06f0}');
  final match = RegExp(r'^(?:STU)?[\s-]*0*(\d{1,9})$').firstMatch(text);
  return match == null ? text : 'STU-${match.group(1)!.padLeft(6, '0')}';
}

/// Digits of a typed phone, with +20 / 0020 turned into the local 0.
String phoneDigits(String input) {
  if (!RegExp(r'^[+\d\s\-٠-٩۰-۹]+$').hasMatch(input.trim())) return '';
  var digits = input.replaceAllMapped(RegExp('[٠-٩]'), (m) => '${m[0]!.codeUnitAt(0) - 0x0660}').replaceAll(RegExp(r'\D'), '');
  // +20 / 0020 written in front (even of a partial number) stands for the local 0.
  if (RegExp(r'^(?:00)?201\d{9}$').hasMatch(digits) || RegExp(r'^\s*(?:\+|00)\s*20').hasMatch(input)) digits = digits.replaceFirst(RegExp(r'^(?:00)?20'), '0');
  return digits;
}

/// One student found by the scan box.
class StudentHit {
  StudentHit({required this.code, required this.name, this.phone = '', this.parentPhone = '', this.centerName = '', this.match = 1, this.present = false, this.blocked = false});
  final String code, name, phone, parentPhone, centerName;

  /// -1 the exact code, 0 same center as the live session, 1 another center
  final int match;
  final bool present, blocked;

  factory StudentHit.fromJson(Map<String, dynamic> m) => StudentHit(
        code: '${m['code'] ?? ''}',
        name: '${m['name'] ?? ''}',
        phone: '${m['phone'] ?? ''}',
        parentPhone: '${m['parentPhone'] ?? ''}',
        centerName: '${m['centerName'] ?? ''}',
        match: (m['match'] as num?)?.toInt() ?? 1,
        present: m['present'] == true,
        blocked: m['blocked'] == true,
      );
}

class SearchResult {
  SearchResult(this.hits, {this.exactCode, int? total}) : total = total ?? hits.length;
  final List<StudentHit> hits;
  final String? exactCode;
  final int total;
}

/// The class as last downloaded (GET /teacher/scan/snapshot), with this phone's queued work applied on top,
/// so scanning keeps working with no internet: who the student is, their balance, center, notes,
/// their last sessions with homework, and whether they were already checked in.
class Snap {
  Snap(this.raw) {
    at = DateTime.tryParse('${raw['at'] ?? ''}')?.toLocal();
    sessions = [for (final s in (raw['sessions'] as List? ?? const [])) Map<String, dynamic>.from(s as Map)]
      ..sort((a, b) => '${b['date']}'.compareTo('${a['date']}'));
    for (final s in (raw['students'] as List? ?? const [])) {
      final student = Map<String, dynamic>.from(s as Map);
      students.add(student);
      byCode['${student['userID']}'.toUpperCase()] = student;
      byId['${student['_id']}'] = student;
    }
    for (final row in (raw['attendance'] as List? ?? const [])) {
      final r = row as List;
      attendance['${r[0]}:${r[1]}'] = {'homework': r.length > 2 ? r[2] : null, 'paid': r.length > 3 ? r[3] : 0};
    }
  }

  final Map<String, dynamic> raw;
  DateTime? at;
  late final List<Map<String, dynamic>> sessions;
  final students = <Map<String, dynamic>>[];
  final byCode = <String, Map<String, dynamic>>{};
  final byId = <String, Map<String, dynamic>>{};

  /// "student:session" → {homework, paid, by}
  final attendance = <String, Map<String, dynamic>>{};

  Map<String, dynamic>? get activeSession => sessions.where((s) => s['active'] == true).firstOrNull;
  Map<String, dynamic>? session(String? id) => id == null ? null : sessions.where((s) => '${s['_id']}' == id).firstOrNull;

  Map<String, dynamic>? student(String input) {
    final text = input.trim();
    return byCode[text.toUpperCase()] ?? byCode[normalizeStudentCode(text)] ?? byId[text];
  }

  Map<String, dynamic>? record(String studentId, String sessionId) => attendance['$studentId:$sessionId'];

  /// The student's last sessions (newest first), like the lookup's lastSessions: present/absent and homework.
  List<Map<String, dynamic>> history(Map<String, dynamic> student, {String? except, int limit = 8}) {
    final joined = DateTime.tryParse('${student['joinedAt'] ?? ''}');
    final center = student['center'];
    return [
      for (final s in sessions)
        if ('${s['_id']}' != except && s['status'] != 'cancelled')
          if (record('${student['_id']}', '${s['_id']}') != null ||
              ((s['center'] == null || center == null || '${s['center']}' == '$center') && (joined == null || !DateTime.parse('${s['date']}').isBefore(joined))))
            {
              'session': s,
              'status': record('${student['_id']}', '${s['_id']}') != null ? 'present' : (s['active'] == true ? 'pending' : 'absent'),
              'homeworkStatus': record('${student['_id']}', '${s['_id']}')?['homework'],
            },
    ].take(limit).toList();
  }

  /// Code, part of a phone (3+ digits) or part of a name. Same ranking as the server.
  SearchResult search(String query) {
    final text = query.trim();
    if (text.isEmpty) return SearchResult(const []);
    final exact = student(text);
    final digits = phoneDigits(text);
    final lower = text.toLowerCase();
    final words = RegExp(r'\p{L}{2,}', unicode: true).hasMatch(text);
    final live = activeSession;
    bool matches(Map<String, dynamic> s) {
      if (digits.length >= 3 && ('${s['phone']}'.contains(digits) || '${s['parentPhone']}'.contains(digits))) return true;
      return words && '${s['firstName']} ${s['lastName']}'.toLowerCase().contains(lower);
    }

    final found = <Map<String, dynamic>>[?exact, for (final s in students) if (s != exact && matches(s)) s];
    int rank(Map<String, dynamic> s) {
      if (s == exact) return -1;
      if (live == null || live['center'] == null || s['center'] == null) return 0;
      return '${live['center']}' == '${s['center']}' ? 0 : 1;
    }

    found.sort((a, b) {
      final r = rank(a).compareTo(rank(b));
      return r != 0 ? r : '${a['firstName']} ${a['lastName']}'.compareTo('${b['firstName']} ${b['lastName']}');
    });
    return SearchResult(
      [
        for (final s in found.take(30))
          StudentHit(
            code: '${s['userID']}',
            name: '${s['firstName']} ${s['lastName']}'.trim(),
            phone: '${s['phone'] ?? ''}',
            parentPhone: '${s['parentPhone'] ?? ''}',
            centerName: '${s['centerName'] ?? ''}',
            match: rank(s),
            present: live != null && record('${s['_id']}', '${live['_id']}') != null,
            blocked: s['isBlocked'] == true,
          ),
      ],
      exactCode: exact == null ? null : '${exact['userID']}',
      total: found.length,
    );
  }

  /// Queued work counts as done, so the same student can't be checked in twice with no internet.
  void apply(QueuedOp op) {
    final s = student('${op.body['identifier'] ?? ''}');
    if (s == null) return;
    final key = '${s['_id']}:${op.sessionId}';
    final session = this.session(op.sessionId);
    if (op.kind == 'attendance' && !attendance.containsKey(key)) {
      final paid = (num.tryParse('${op.body['payment'] ?? 0}') ?? 0);
      final price = (s['pricePerSession'] as num?) ?? (session?['price'] as num?) ?? 0;
      attendance[key] = {'homework': op.body['homeworkStatus'], 'paid': paid, 'by': 'this phone'};
      s['balance'] = ((s['balance'] as num?) ?? 0) + paid - price;
    } else if (op.kind == 'homework' && attendance.containsKey(key)) {
      attendance[key]!['homework'] = op.body['status'];
    } else if (op.kind == 'payment' && attendance.containsKey(key)) {
      final amount = num.tryParse('${op.body['amount'] ?? 0}') ?? 0;
      attendance[key]!['paid'] = ((attendance[key]!['paid'] as num?) ?? 0) + amount;
      s['balance'] = ((s['balance'] as num?) ?? 0) + amount;
    }
  }
}

/// Offline scanning, the same idea as the Studyisfunny app: the phone keeps a snapshot of the class, checks codes
/// against it with no internet, queues the work and sends it when the connection returns.
class Outbox {
  static final items = ValueNotifier<List<QueuedOp>>([]);
  static final snap = ValueNotifier<Snap?>(null);
  static final syncing = ValueNotifier<bool>(false);

  /// Goes up whenever the saved copy changes in place (queued work applied to it).
  static final revision = ValueNotifier<int>(0);
  static bool _sending = false;
  static bool _listening = false;
  static Timer? _timer;

  static String get _scope => '${Session.role?.name}:${Session.identifier}';
  static String get _key => 'outbox2:$_scope';
  static String get _snapKey => 'scansnap:$_scope';
  static String get _legacyKey => 'outbox:$_scope';

  static Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key);
    final list = raw == null ? <QueuedOp>[] : [for (final item in jsonDecode(raw) as List) QueuedOp.fromJson(Map<String, dynamic>.from(item as Map))];
    // Check-ins queued by the previous version of the app.
    final legacy = prefs.getString(_legacyKey);
    if (legacy != null) {
      for (final item in jsonDecode(legacy) as List) {
        final m = Map<String, dynamic>.from(item as Map);
        list.add(QueuedOp(id: '${m['id']}', kind: 'attendance', sessionId: '${m['sessionId']}', body: Map<String, dynamic>.from(m['body'] as Map), name: '${m['name'] ?? ''}', at: DateTime.tryParse('${m['at']}') ?? DateTime.now(), error: m['error'] as String?));
      }
      await prefs.remove(_legacyKey);
    }
    items.value = list;
    await _save();
    final savedSnap = prefs.getString(_snapKey);
    if (savedSnap != null) {
      try {
        snap.value = _withQueue(Snap(Map<String, dynamic>.from(jsonDecode(savedSnap) as Map)));
      } catch (_) {/* an old or broken copy: the next refresh replaces it */}
    }
    if (!_listening) {
      _listening = true;
      Connection.online.addListener(_onlineChanged);
    }
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 45), (_) => flush());
  }

  static void _onlineChanged() {
    if (Connection.online.value) {
      flush();
      refreshSnapshot();
    }
  }

  static Snap _withQueue(Snap s) {
    for (final op in items.value) {
      if (op.error == null) s.apply(op);
    }
    return s;
  }

  static Future<void> _save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, jsonEncode([for (final item in items.value) item.toJson()]));
  }

  /// Downloads the class for offline scanning. Returns false when the server couldn't be reached.
  static Future<bool> refreshSnapshot() async {
    if (Session.role == null) return false;
    try {
      final data = await Api.get('/teacher/scan/snapshot');
      final map = Map<String, dynamic>.from(data as Map);
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_snapKey, jsonEncode(map));
      snap.value = _withQueue(Snap(map));
      return true;
    } on ApiError {
      return false;
    }
  }

  static String newId() {
    final random = Random.secure();
    return 'm-${DateTime.now().millisecondsSinceEpoch.toRadixString(36)}-${List.generate(10, (_) => random.nextInt(36).toRadixString(36)).join()}';
  }

  static Future<QueuedOp> add({required String kind, required String sessionId, required Map<String, dynamic> body, required String name, String? id}) async {
    final op = QueuedOp(id: id ?? newId(), kind: kind, sessionId: sessionId, body: body, name: name, at: DateTime.now());
    items.value = [...items.value, op];
    await _save();
    final current = snap.value;
    if (current != null) {
      current.apply(op);
      revision.value++;
    }
    return op;
  }

  static Future<void> remove(String id) async {
    items.value = items.value.where((item) => item.id != id).toList();
    await _save();
  }

  static Future<void> retry(String id) async {
    for (final item in items.value) {
      if (item.id == id) item.error = null;
    }
    items.value = List.from(items.value);
    await _save();
    await flush();
  }

  static int get waiting => items.value.where((item) => item.error == null).length;
  static int get problems => items.value.where((item) => item.error != null).length;

  static Future<void> _send(QueuedOp op) async {
    switch (op.kind) {
      case 'homework':
        await Api.post('/teacher/sessions/${op.sessionId}/homework', op.body);
      case 'payment':
        await Api.post('/teacher/sessions/${op.sessionId}/attendance/add-payment', {...op.body, 'opId': op.id});
      default:
        await Api.post('/teacher/sessions/${op.sessionId}/attendance', {...op.body, 'offline': true, 'scannedAt': op.at.toUtc().toIso8601String()});
    }
  }

  /// Sends everything still waiting, oldest first. Returns how many were recorded.
  static Future<int> flush() async {
    if (_sending || Session.role == null || items.value.isEmpty) return 0;
    _sending = true;
    syncing.value = true;
    var sent = 0;
    try {
      for (final op in List<QueuedOp>.from(items.value)) {
        if (op.error != null) continue;
        try {
          await _send(op);
          await remove(op.id);
          sent += 1;
        } on ApiError catch (error) {
          if (error.offline) break;
          // Already recorded (by this phone before the reply was lost, or by someone else): nothing to do.
          if (error.status == 409 && error.message.toLowerCase().contains('already')) {
            await remove(op.id);
            sent += 1;
            continue;
          }
          op.error = error.message;
          items.value = List.from(items.value);
          await _save();
        }
      }
    } finally {
      _sending = false;
      syncing.value = false;
    }
    if (sent > 0) unawaited(refreshSnapshot());
    return sent;
  }
}
