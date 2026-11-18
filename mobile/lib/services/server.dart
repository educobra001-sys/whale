import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// Where the EduCobra server is: the online deployment (for example https://educobra.vercel.app) or, for
/// testing, a computer on the same Wi-Fi (http://192.168.1.20:4000). It can be changed from the sign-in screen.
class Server {
  static const _key = 'server.url';
  static const _recentKey = 'server.recent';

  /// The online address baked into a build: build-apk.bat https://your-app.vercel.app
  /// (or flutter build apk --dart-define=SERVER_URL=https://your-app.vercel.app).
  static const builtIn = String.fromEnvironment('SERVER_URL');

  static String _url = '';
  static List<String> _recent = [];
  static String get url => _url;
  static bool get isSet => _url.isNotEmpty;
  static List<String> get recent => List.unmodifiable(_recent);
  static String get onlineDefault => normalize(builtIn);

  /// https servers are online deployments (Vercel). Plain http ones are a computer on the local network.
  static bool get isOnline => _url.startsWith('https://');

  /// A short name for the address, like "educobra.vercel.app".
  static String get label => Uri.tryParse(_url)?.authority ?? _url;

  static const _builtInKey = 'server.builtIn';

  static Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    _recent = prefs.getStringList(_recentKey) ?? [];
    final online = normalize(builtIn);
    // Android keeps the old saved address when a new build is installed over an old one. The first time a build
    // with a different built-in address opens, switch to it; after that the user's own choice is kept.
    if (online.isNotEmpty && prefs.getString(_builtInKey) != online) {
      await prefs.setString(_builtInKey, online);
      await save(online);
      return;
    }
    _url = prefs.getString(_key) ?? online;
  }

  static bool _isLocalHost(String host) =>
      host == 'localhost' ||
      RegExp(r'^(\d{1,3}\.){3}\d{1,3}$').hasMatch(host) ||
      host.endsWith('.local');

  /// Accepts "192.168.1.20", "192.168.1.20:4000", "educobra.vercel.app" or a full link, and returns a clean base URL.
  /// Addresses on the local network default to http on port 4000; anything else to https.
  static String normalize(String input) {
    var value = input.trim();
    if (value.isEmpty) return '';
    final link = RegExp(r'url=([^&\s]+)').firstMatch(value);
    if (link != null) value = Uri.decodeComponent(link.group(1)!);
    if (!value.startsWith(RegExp(r'https?://', caseSensitive: false))) {
      final host = value.split(RegExp(r'[:/]')).first.toLowerCase();
      value = '${_isLocalHost(host) ? 'http' : 'https'}://$value';
    }
    final uri = Uri.tryParse(value);
    if (uri == null || uri.host.isEmpty) return '';
    final local = _isLocalHost(uri.host);
    final port = uri.hasPort ? uri.port : (local && uri.scheme == 'http' ? 4000 : null);
    return Uri(scheme: uri.scheme.toLowerCase(), host: uri.host.toLowerCase(), port: port).toString().replaceAll(RegExp(r'/+$'), '');
  }

  /// Checks that the address really is an EduCobra server before saving it.
  /// An online server that has been quiet takes a few seconds to wake up, so it is given time and a second try.
  static Future<String> verify(String input) async {
    final base = normalize(input);
    if (base.isEmpty) throw const FormatException('Enter the server address, for example educobra.vercel.app');
    final online = base.startsWith('https://');
    http.Response? response;
    for (var attempt = 0; attempt < (online ? 2 : 1) && response == null; attempt++) {
      try {
        response = await http.get(Uri.parse('$base/check-health')).timeout(Duration(seconds: online ? 30 : 8));
      } on TimeoutException {
        response = null;
      } catch (_) {
        response = null;
        if (!online) break;
      }
    }
    if (response == null) {
      throw FormatException(online
          ? 'Could not reach $base. Check the internet connection and the address, then try again.'
          : 'Could not reach $base. Check that the phone and the computer are on the same Wi-Fi and the server is running.');
    }
    try {
      final body = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
      final data = body['data'];
      if (response.statusCode == 200 && body['message'] == 'healthy' && (data is! Map || data['app'] == null || data['app'] == 'educobra')) return base;
      // Vercel answers this way when the API runs but can't reach its database.
      if (response.statusCode == 503 && body['reason'] != null) throw FormatException('The server is up but not ready: ${body['reason']}');
    } on FormatException {
      rethrow;
    } catch (_) {/* not JSON */}
    throw FormatException('$base answered, but it is not an EduCobra server.');
  }

  static Future<void> save(String base) async {
    _url = base;
    _recent = [base, ..._recent.where((item) => item != base)].take(5).toList();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, base);
    await prefs.setStringList(_recentKey, _recent);
  }

  /// Turns "/files/x.png" from the API into a full link on this server.
  static String file(String? path) {
    if (path == null || path.isEmpty) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    return '$_url${path.startsWith('/') ? '' : '/'}$path';
  }
}
