import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
// http's MultipartFile takes a MediaType from package:http_parser, which http already depends on.
// ignore: depend_on_referenced_packages
import 'package:http_parser/http_parser.dart' show MediaType;
import 'package:shared_preferences/shared_preferences.dart';

import 'server.dart';
import 'session.dart';

class ApiError implements Exception {
  ApiError(this.message, {this.status = 0, this.details});
  final String message;

  /// 0 means the server couldn't be reached.
  final int status;
  final dynamic details;
  bool get offline => status == 0;
  String? get code => details is Map ? details['code'] as String? : null;
  @override
  String toString() => message;
}

/// A read that may have come from the phone's saved copy because the server was unreachable.
class Loaded<T> {
  Loaded(this.data, {this.fromCache = false, this.savedAt});
  final T data;
  final bool fromCache;
  final DateTime? savedAt;
}

/// Online state. Screens listen to it, and the offline queue sends what it holds when it turns true.
class Connection {
  static final online = ValueNotifier<bool>(true);
  static StreamSubscription<List<ConnectivityResult>>? _sub;

  static Future<void> start() async {
    if (_sub != null) return;
    try {
      final connectivity = Connectivity();
      _apply(await connectivity.checkConnectivity());
      _sub = connectivity.onConnectivityChanged.listen(_apply);
    } catch (_) {/* no plugin in tests */}
  }

  static void _apply(List<ConnectivityResult> results) => report(results.any((r) => r != ConnectivityResult.none));

  static void report(bool ok) {
    if (online.value != ok) online.value = ok;
  }
}

class Api {
  /// An online server that has been quiet needs a few seconds to wake up; a server on the Wi-Fi answers at once.
  static Duration get _timeout => Server.isOnline ? const Duration(seconds: 35) : const Duration(seconds: 20);

  /// Vercel refuses request bodies over about 4.5 MB.
  static const onlineUploadLimit = 4 * 1024 * 1024;

  static String get unreachable => Server.isOnline
      ? 'Could not reach the server. Check your internet connection and try again.'
      : 'Could not reach the server. Check the Wi-Fi and that the EduCobra server is running.';

  /// True while a request has been waiting long enough that the server is probably waking up.
  static final waking = ValueNotifier<bool>(false);
  static int _slow = 0;

  /// Called when the saved sign-in no longer works, so the app can go back to the sign-in screen.
  static VoidCallback? onSignedOut;
  static Future<String>? _refreshing;

  static Uri _uri(String path, [Map<String, dynamic>? query]) {
    final params = <String, String>{};
    query?.forEach((key, value) {
      if (value != null && '$value'.isNotEmpty) params[key] = '$value';
    });
    final uri = Uri.parse('${Server.url}$path');
    return params.isEmpty ? uri : uri.replace(queryParameters: {...uri.queryParameters, ...params});
  }

  static Map<String, String> _headers(bool json, bool auth) => {
        if (json) 'Content-Type': 'application/json',
        'Accept': 'application/json',
        if (auth && Session.accessToken.isNotEmpty) 'Authorization': 'Bearer ${Session.accessToken}',
      };

  static Future<http.Response> _send(String method, String path, {Object? body, Map<String, dynamic>? query, bool auth = true}) async {
    final request = http.Request(method, _uri(path, query));
    request.headers.addAll(_headers(body != null, auth));
    if (body != null) request.body = jsonEncode(body);
    final slow = Timer(const Duration(seconds: 4), () {
      _slow++;
      waking.value = true;
    });
    try {
      final streamed = await request.send().timeout(_timeout);
      final response = await http.Response.fromStream(streamed);
      Connection.report(true);
      return response;
    } on TimeoutException {
      // A read is safe to repeat once: the first try usually woke the server up.
      if (method == 'GET' && !_retrying) {
        _retrying = true;
        try {
          return await _send(method, path, body: body, query: query, auth: auth);
        } finally {
          _retrying = false;
        }
      }
      Connection.report(false);
      throw ApiError(unreachable);
    } catch (_) {
      Connection.report(false);
      throw ApiError(unreachable);
    } finally {
      if (!slow.isActive) {
        _slow = _slow > 0 ? _slow - 1 : 0;
        if (_slow == 0) waking.value = false;
      }
      slow.cancel();
    }
  }

  static bool _retrying = false;

  static dynamic _decode(http.Response response) {
    Map<String, dynamic>? json;
    try {
      json = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
    } catch (_) {
      json = null;
    }
    if (response.statusCode >= 200 && response.statusCode < 300) return json?['data'];
    final message = json?['message'] as String?;
    if (response.statusCode == 429) throw ApiError(message ?? 'Too many attempts. Please wait a little.', status: 429);
    if (response.statusCode == 413) throw ApiError('This file is too big for the server. Online, files can be up to 4 MB; use a YouTube or Drive link for videos.', status: 413);
    if (response.statusCode == 503 && json?['reason'] != null) throw ApiError('${message ?? 'The server is not ready'}: ${json!['reason']}', status: 503);
    throw ApiError(message ?? 'The request could not be completed (${response.statusCode}).', status: response.statusCode, details: json?['cause']);
  }

  static Future<String> _refresh() {
    return _refreshing ??= () async {
      try {
        final response = await _send('POST', '/refresh-token', body: {'refreshToken': Session.refreshToken}, auth: false);
        final data = _decode(response) as Map<String, dynamic>;
        final token = data['accessToken'] as String;
        await Session.updateAccess(token);
        return token;
      } on ApiError catch (error) {
        if (!error.offline) {
          await Session.clear();
          onSignedOut?.call();
          throw ApiError('Your session ended. Please sign in again.', status: 401);
        }
        rethrow;
      } finally {
        _refreshing = null;
      }
    }();
  }

  static Future<dynamic> request(String method, String path, {Object? body, Map<String, dynamic>? query, bool auth = true}) async {
    var response = await _send(method, path, body: body, query: query, auth: auth);
    if (auth && response.statusCode == 401 && Session.refreshToken.isNotEmpty) {
      await _refresh();
      response = await _send(method, path, body: body, query: query, auth: auth);
    }
    return _decode(response);
  }

  static Future<dynamic> get(String path, [Map<String, dynamic>? query]) => request('GET', path, query: query);
  static Future<dynamic> post(String path, [Object? body]) => request('POST', path, body: body ?? const {});
  static Future<dynamic> patch(String path, [Object? body]) => request('PATCH', path, body: body ?? const {});
  static Future<dynamic> put(String path, [Object? body]) => request('PUT', path, body: body ?? const {});
  static Future<dynamic> delete(String path, [Object? body]) => request('DELETE', path, body: body);

  // ---------- saved copies for offline reading ----------
  static String _cacheKey(String path) => 'cache:${Session.role?.name}:${Session.identifier}:$path';

  /// Reads from the server and keeps a copy. With no connection, returns the last copy instead.
  static Future<Loaded<dynamic>> cached(String path, [Map<String, dynamic>? query]) async {
    final key = _cacheKey(_uri(path, query).toString().replaceFirst(Server.url, ''));
    try {
      final data = await get(path, query);
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(key, jsonEncode({'at': DateTime.now().toIso8601String(), 'data': data}));
      return Loaded(data);
    } on ApiError catch (error) {
      if (!error.offline) rethrow;
      final saved = await readCache(key);
      if (saved == null) rethrow;
      return saved;
    }
  }

  static Future<Loaded<dynamic>?> readCache(String key) async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(key);
    if (raw == null) return null;
    final json = jsonDecode(raw) as Map<String, dynamic>;
    return Loaded(json['data'], fromCache: true, savedAt: DateTime.tryParse(json['at'] ?? ''));
  }

  static Future<void> clearCache() async {
    final prefs = await SharedPreferences.getInstance();
    for (final key in prefs.getKeys().where((key) => key.startsWith('cache:')).toList()) {
      await prefs.remove(key);
    }
  }

  // ---------- uploads ----------
  /// Sends a photo, PDF or MP4 to /uploads and returns its link.
  static Future<String> upload(String filePath, {String? contentType}) async {
    if (Server.isOnline) {
      final size = await File(filePath).length().catchError((_) => 0);
      if (size > onlineUploadLimit) {
        throw ApiError('This file is ${(size / 1024 / 1024).toStringAsFixed(1)} MB. The online server accepts up to 4 MB; use a smaller photo, or a YouTube/Drive link for videos.', status: 413);
      }
    }
    Future<http.StreamedResponse> send() async {
      final request = http.MultipartRequest('POST', _uri('/uploads'));
      request.headers.addAll(_headers(false, true));
      final type = contentType ?? _typeOf(filePath);
      final parts = type.split('/');
      request.files.add(await http.MultipartFile.fromPath('file', filePath, contentType: _mediaType(parts.first, parts.last)));
      return request.send().timeout(const Duration(minutes: 3));
    }

    http.Response response;
    try {
      response = await http.Response.fromStream(await send());
      if (response.statusCode == 401 && Session.refreshToken.isNotEmpty) {
        await _refresh();
        response = await http.Response.fromStream(await send());
      }
    } on ApiError {
      rethrow;
    } catch (_) {
      Connection.report(false);
      throw ApiError('Could not upload the file. Check the connection and try again.');
    }
    final data = _decode(response) as Map<String, dynamic>;
    return data['url'] as String;
  }

  static String _typeOf(String path) {
    final lower = path.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.pdf')) return 'application/pdf';
    if (lower.endsWith('.mp4')) return 'video/mp4';
    return 'image/jpeg';
  }
}


MediaType _mediaType(String type, String subtype) => MediaType(type, subtype);
