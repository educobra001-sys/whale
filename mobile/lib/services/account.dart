import 'sections.dart';
import 'api.dart';
import 'session.dart';

/// Who is signed in, with what the website uses to decide which sections to show.
class Account {
  Account({required this.role, required this.profile, this.permissions = const {}, this.features = const {}, this.allPermissions = false});

  final Role role;
  final Map<String, dynamic> profile;
  final Set<String> permissions;
  final Set<String> features;
  final bool allPermissions;

  static Account? current;

  String get name {
    final first = profile['firstName'] ?? '';
    final last = profile['lastName'] ?? '';
    final full = '$first $last'.trim();
    return full.isNotEmpty ? full : (profile['name'] ?? profile['userName'] ?? profile['phone'] ?? '').toString();
  }

  bool can(String permission) => allPermissions || permissions.contains(permission);
  bool canAny(List<String> list) => list.any(can);

  /// Sections the owner sold to this teacher. Center, school, student and parent accounts aren't gated.
  /// Sections the owner hasn't published yet are off for everyone.
  bool has(String feature) => Sections.on(feature) && (!role.isStaff || features.contains(feature));

  static Future<Account> load() async {
    final role = Session.role!;
    await Sections.load();
    Account account;
    switch (role) {
      case Role.teacher:
        final profile = Map<String, dynamic>.from(await Api.get('/teacher/profile'));
        account = Account(role: role, profile: profile, allPermissions: true, features: _set(profile['features']));
      case Role.assistant:
        final profile = Map<String, dynamic>.from(await Api.get('/assistant/profile'));
        final admin = profile['role'] == 'Admin';
        account = Account(role: role, profile: profile, allPermissions: admin, permissions: _set(profile['permissions']), features: _set(profile['features']));
      case Role.center:
      case Role.school:
        account = Account(role: role, profile: Map<String, dynamic>.from(await Api.get('/${role.name}/profile')));
      case Role.student:
        account = Account(role: role, profile: Map<String, dynamic>.from(await Api.get('/student/profile')));
      case Role.parent:
        account = Account(role: role, profile: Map<String, dynamic>.from(await Api.get('/parent/profile')));
    }
    current = account;
    return account;
  }

  static Set<String> _set(dynamic list) => {for (final item in (list as List? ?? const [])) '$item'};
}
