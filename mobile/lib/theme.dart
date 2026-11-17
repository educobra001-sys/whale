import 'package:flutter/material.dart';

/// The same warm palette as the EduCobra website.
class AppColors {
  static const accent = Color(0xFFFFB43F);
  static const accentDeep = Color(0xFFD98C18);
  static const accentText = Color(0xFFA56E1C);
  static const accentSoft = Color(0xFFFFF1D5);
  static const ink = Color(0xFF2F2B25);
  static const text = Color(0xFF484641);
  static const muted = Color(0xFF777166);
  static const bg = Color(0xFFFFF8EB);
  static const surface = Color(0xFFFFFEFA);
  static const line = Color(0xFFEFE4CF);
  static const success = Color(0xFF4C6B14);
  static const successSoft = Color(0xFFEEF6D6);
  static const warn = Color(0xFF8A5A0A);
  static const warnSoft = Color(0xFFFFF0CC);
  static const danger = Color(0xFF8F3E2E);
  static const dangerSoft = Color(0xFFFFF0EB);
  static const info = Color(0xFF2F5E8A);
  static const infoSoft = Color(0xFFE6F0FA);
}

ThemeData buildTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: AppColors.accent,
    primary: AppColors.accentDeep,
    onPrimary: Colors.white,
    secondary: AppColors.accent,
    surface: AppColors.surface,
  );
  final rounded = RoundedRectangleBorder(borderRadius: BorderRadius.circular(14));
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: AppColors.bg,
    appBarTheme: const AppBarTheme(
      backgroundColor: AppColors.bg,
      foregroundColor: AppColors.ink,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: AppColors.ink),
    ),
    cardTheme: CardThemeData(
      color: AppColors.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18), side: const BorderSide(color: AppColors.line)),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppColors.line)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppColors.line)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppColors.accentDeep, width: 2)),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: AppColors.accent,
        foregroundColor: AppColors.ink,
        minimumSize: const Size.fromHeight(50),
        shape: rounded,
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: AppColors.ink,
        minimumSize: const Size(0, 44),
        side: const BorderSide(color: AppColors.line),
        shape: rounded,
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: AppColors.surface,
      indicatorColor: AppColors.accentSoft,
      labelTextStyle: WidgetStateProperty.all(const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.ink)),
    ),
    snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
  );
}
