import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'server.dart';

/// Sections the owner keeps hidden until they're published (video lessons, exams...). Asked from the server
/// whenever the account loads; the last answer is kept for when the phone is offline.
class Sections {
  static const _key = 'sections.hidden';
  static Set<String> _hidden = {};

  static bool on(String key) => !_hidden.contains(key);

  static Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    _hidden = {...?prefs.getStringList(_key)};
    if (!Server.isSet) return;
    try {
      final response = await http.get(Uri.parse('${Server.url}/app-config')).timeout(const Duration(seconds: 20));
      if (response.statusCode != 200) return;
      final data = (jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>)['data'];
      final hidden = <String>{for (final item in (data is Map ? data['hiddenSections'] as List? : null) ?? const []) '$item'};
      _hidden = hidden;
      await prefs.setStringList(_key, hidden.toList());
    } catch (_) {/* offline: keep the saved list */}
  }
}
