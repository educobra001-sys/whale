import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'session.dart';

/// A check-in accepted on this phone while the server couldn't be reached.
class QueuedScan {
  QueuedScan({required this.id, required this.sessionId, required this.body, required this.name, required this.at, this.error});

  final String id;
  final String sessionId;
  final Map<String, dynamic> body;
  final String name;
  final DateTime at;

  /// Set when the server refused it, so a person can look at it.
  String? error;

  Map<String, dynamic> toJson() => {'id': id, 'sessionId': sessionId, 'body': body, 'name': name, 'at': at.toIso8601String(), 'error': error};

  static QueuedScan fromJson(Map<String, dynamic> json) => QueuedScan(
        id: json['id'],
        sessionId: json['sessionId'],
        body: Map<String, dynamic>.from(json['body']),
        name: json['name'] ?? '',
        at: DateTime.tryParse(json['at'] ?? '') ?? DateTime.now(),
        error: json['error'],
      );
}

/// Offline attendance, the same idea as the Studyisfunny app: the phone keeps a snapshot of the class,
/// checks codes against it with no internet, queues the check-ins and sends them when the connection
/// returns. The server records them as they happened (offline: true + the real scan time).
class Outbox {
  static final items = ValueNotifier<List<QueuedScan>>([]);
  static bool _sending = false;

  static String get _key => 'outbox:${Session.role?.name}:${Session.identifier}';
  static String get _snapshotKey => 'snapshot:${Session.role?.name}:${Session.identifier}';

  static Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key);
    items.value = raw == null ? [] : (jsonDecode(raw) as List).map((item) => QueuedScan.fromJson(Map<String, dynamic>.from(item))).toList();
    Connection.online.addListener(_onlineChanged);
  }

  static void _onlineChanged() {
    if (Connection.online.value) flush();
  }

  static Future<void> _save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, jsonEncode(items.value.map((item) => item.toJson()).toList()));
  }

  static Future<void> add({required String sessionId, required Map<String, dynamic> body, required String name}) async {
    final id = '${DateTime.now().microsecondsSinceEpoch}-${Random().nextInt(1 << 20)}';
    items.value = [...items.value, QueuedScan(id: id, sessionId: sessionId, body: body, name: name, at: DateTime.now())];
    await _save();
  }

  static Future<void> remove(String id) async {
    items.value = items.value.where((item) => item.id != id).toList();
    await _save();
  }

  static int get waiting => items.value.where((item) => item.error == null).length;

  /// Sends everything still waiting. Returns how many were recorded.
  static Future<int> flush() async {
    if (_sending || Session.role == null) return 0;
    _sending = true;
    var sent = 0;
    try {
      for (final item in List<QueuedScan>.from(items.value)) {
        if (item.error != null) continue;
        try {
          await Api.post('/teacher/sessions/${item.sessionId}/attendance', {...item.body, 'offline': true, 'scannedAt': item.at.toUtc().toIso8601String()});
          await remove(item.id);
          sent += 1;
        } on ApiError catch (error) {
          if (error.offline) break;
          if (error.status == 409 && error.message.toLowerCase().contains('already marked')) {
            await remove(item.id);
            sent += 1;
            continue;
          }
          item.error = error.message;
          items.value = List.from(items.value);
          await _save();
        }
      }
    } finally {
      _sending = false;
    }
    return sent;
  }

  // ---------- class snapshot for offline lookups ----------
  static Future<void> saveSnapshot(List<dynamic> students, Map<String, dynamic>? activeSession) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_snapshotKey, jsonEncode({'at': DateTime.now().toIso8601String(), 'students': students, 'session': activeSession}));
  }

  static Future<Map<String, dynamic>?> snapshot() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_snapshotKey);
    return raw == null ? null : Map<String, dynamic>.from(jsonDecode(raw));
  }

  /// Finds a student in the saved class by code, phone or id.
  static Future<Map<String, dynamic>?> findOffline(String code) async {
    final snap = await snapshot();
    if (snap == null) return null;
    final needle = code.trim().toUpperCase();
    final digits = code.replaceAll(RegExp(r'\D'), '');
    for (final raw in (snap['students'] as List? ?? const [])) {
      final student = Map<String, dynamic>.from(raw);
      if ('${student['userID']}'.toUpperCase() == needle || '${student['_id']}' == code.trim() || (digits.length >= 8 && '${student['phone']}'.replaceAll(RegExp(r'\D'), '') == digits)) {
        return student;
      }
    }
    return null;
  }
}
