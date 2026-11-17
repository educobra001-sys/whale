import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// Where the EduCobra server is. For local testing this is the computer running it on the same Wi-Fi,
/// for example http://192.168.1.20:4000. It can be changed any time from the sign-in screen.
class Server {
  static const _key = 'server.url';

  /// A build can bake a default in: flutter build apk --dart-define=SERVER_URL=http://192.168.1.20:4000
  static const _builtIn = String.fromEnvironment('SERVER_URL');

  static String _url = '';
  static String get url => _url;
  static bool get isSet => _url.isNotEmpty;

  static Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    _url = prefs.getString(_key) ?? _builtIn;
  }

  /// Accepts "192.168.1.20", "192.168.1.20:4000" or a full link, and returns a clean base URL.
  static String normalize(String input) {
    var value = input.trim();
    if (value.isEmpty) return '';
    final link = RegExp(r'url=([^&\s]+)').firstMatch(value);
    if (link != null) value = Uri.decodeComponent(link.group(1)!);
    if (!value.startsWith(RegExp(r'https?://', caseSensitive: false))) value = 'http://$value';
    final uri = Uri.tryParse(value);
    if (uri == null || uri.host.isEmpty) return '';
    final local = RegExp(r'^(\d{1,3}\.){3}\d{1,3}$').hasMatch(uri.host) || uri.host == 'localhost';
    final port = uri.hasPort ? uri.port : (local && uri.scheme == 'http' ? 4000 : null);
    return Uri(scheme: uri.scheme.toLowerCase(), host: uri.host, port: port).toString().replaceAll(RegExp(r'/+$'), '');
  }

  /// Checks that the address really is an EduCobra server before saving it.
  static Future<String> verify(String input) async {
    final base = normalize(input);
    if (base.isEmpty) throw const FormatException('Enter the server address, for example 192.168.1.20:4000');
    final http.Response response;
    try {
      response = await http.get(Uri.parse('$base/check-health')).timeout(const Duration(seconds: 6));
    } catch (_) {
      throw FormatException('Could not reach $base. Check that the phone and the computer are on the same Wi-Fi and the server is running.');
    }
    try {
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      final data = body['data'];
      if (response.statusCode == 200 && body['message'] == 'healthy' && (data is! Map || data['app'] == null || data['app'] == 'educobra')) return base;
    } catch (_) {/* not JSON */}
    throw FormatException('$base answered, but it is not an EduCobra server.');
  }

  static Future<void> save(String base) async {
    _url = base;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, base);
  }

  /// Turns "/files/x.png" from the API into a full link on this server.
  static String file(String? path) {
    if (path == null || path.isEmpty) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    return '$_url${path.startsWith('/') ? '' : '/'}$path';
  }
}
