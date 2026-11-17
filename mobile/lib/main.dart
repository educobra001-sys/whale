import 'package:flutter/material.dart';

import 'screens/connect_screen.dart';
import 'screens/login_screen.dart';
import 'screens/home_router.dart';
import 'services/api.dart';
import 'services/outbox.dart';
import 'services/server.dart';
import 'services/session.dart';
import 'theme.dart';

final navigatorKey = GlobalKey<NavigatorState>();

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Server.load();
  await Session.load();
  await Connection.start();
  if (Session.signedIn) await Outbox.load();
  Api.onSignedOut = () => navigatorKey.currentState?.pushAndRemoveUntil(MaterialPageRoute(builder: (_) => const LoginScreen()), (_) => false);
  runApp(const EduCobraApp());
}

class EduCobraApp extends StatelessWidget {
  const EduCobraApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'EduCobra',
      debugShowCheckedModeBanner: false,
      navigatorKey: navigatorKey,
      theme: buildTheme(),
      home: !Server.isSet ? const ConnectScreen() : (Session.signedIn ? const HomeRouter() : const LoginScreen()),
    );
  }
}
