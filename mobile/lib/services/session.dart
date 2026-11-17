import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Account types, the same as the website's.
enum Role { student, parent, teacher, assistant, center, school }

extension RoleInfo on Role {
  String get key => name;
  String get label => switch (this) {
        Role.student => 'Student',
        Role.parent => 'Parent',
        Role.teacher => 'Teacher',
        Role.assistant => 'Assistant',
        Role.center => 'Learning center',
        Role.school => 'School / organization',
      };
  String get identifierHint => switch (this) {
        Role.student => 'Student code (STU-…) or phone',
        Role.parent => 'Parent phone number',
        Role.teacher => 'Email, phone or username',
        Role.assistant => 'Email, phone or username',
        Role.center => 'Center name or phone',
        Role.school => 'School name or phone',
      };
  bool get isStaff => this == Role.teacher || this == Role.assistant;
  bool get isPlace => this == Role.center || this == Role.school;
}

Role? roleFrom(String? value) => Role.values.where((role) => role.name == value).firstOrNull;

/// Sign-in tokens, kept in the phone's encrypted storage until the user signs out.
class Session {
  static const _storage = FlutterSecureStorage();
  static const _key = 'session.v1';

  static String accessToken = '';
  static String refreshToken = '';
  static Role? role;
  static String identifier = '';

  static bool get signedIn => role != null && refreshToken.isNotEmpty;

  static Future<void> load() async {
    try {
      final raw = await _storage.read(key: _key);
      if (raw == null) return;
      final data = jsonDecode(raw) as Map<String, dynamic>;
      accessToken = data['access'] ?? '';
      refreshToken = data['refresh'] ?? '';
      role = roleFrom(data['role']);
      identifier = data['identifier'] ?? '';
    } catch (_) {
      await clear();
    }
  }

  static Future<void> save({required String access, required String refresh, required Role as, required String id}) async {
    accessToken = access;
    refreshToken = refresh;
    role = as;
    identifier = id;
    await _persist();
  }

  static Future<void> updateAccess(String access) async {
    accessToken = access;
    await _persist();
  }

  static Future<void> _persist() => _storage.write(
        key: _key,
        value: jsonEncode({'access': accessToken, 'refresh': refreshToken, 'role': role?.name, 'identifier': identifier}),
      );

  static Future<void> clear() async {
    accessToken = '';
    refreshToken = '';
    role = null;
    try {
      await _storage.delete(key: _key);
    } catch (_) {/* nothing stored */}
  }
}
