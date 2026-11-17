import 'package:flutter/material.dart';

import '../services/api.dart';
import '../services/outbox.dart';
import '../services/server.dart';
import '../services/session.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'connect_screen.dart';
import 'home_router.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  Role _role = Session.role ?? Role.student;
  late final _identifier = TextEditingController(text: Session.identifier);
  final _password = TextEditingController();
  bool _busy = false;
  bool _hide = true;
  String? _error;

  Future<void> _signIn() async {
    final identifier = _identifier.text.trim();
    if (identifier.isEmpty || _password.text.isEmpty) {
      setState(() => _error = 'Enter your sign-in details.');
      return;
    }
    setState(() => (_busy = true, _error = null));
    try {
      final data = asMap(await Api.request('POST', '/login/${_role.name}', body: {'identifier': identifier, 'password': _password.text}, auth: false));
      await Session.save(access: data['accessToken'], refresh: data['refreshToken'], as: _role, id: identifier);
      await Outbox.load();
      if (!mounted) return;
      Navigator.of(context).pushAndRemoveUntil(MaterialPageRoute(builder: (_) => const HomeRouter()), (_) => false);
    } on ApiError catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: ListView(padding: const EdgeInsets.fromLTRB(22, 24, 22, 32), children: [
          Row(children: [
            const Icon(Icons.school_rounded, color: AppColors.accentDeep, size: 34),
            const SizedBox(width: 8),
            const Text('EduCobra', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: AppColors.ink)),
            const Spacer(),
            TextButton.icon(
              onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ConnectScreen(canGoBack: true))),
              icon: const Icon(Icons.computer, size: 18),
              label: Text(Uri.tryParse(Server.url)?.authority ?? 'Server', style: const TextStyle(fontSize: 12)),
            ),
          ]),
          const Gap(22),
          const Text('Sign in', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: AppColors.ink)),
          const Text('Choose your account type.', style: TextStyle(color: AppColors.muted)),
          const Gap(14),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final role in Role.values)
              ChoiceChip(
                label: Text(role.label),
                selected: _role == role,
                selectedColor: AppColors.accentSoft,
                onSelected: (_) => setState(() => (_role = role, _error = null)),
              ),
          ]),
          const Gap(20),
          TextField(
            controller: _identifier,
            autocorrect: false,
            textInputAction: TextInputAction.next,
            decoration: InputDecoration(labelText: _role.identifierHint, prefixIcon: const Icon(Icons.person_outline)),
          ),
          const Gap(12),
          TextField(
            controller: _password,
            obscureText: _hide,
            onSubmitted: (_) => _signIn(),
            decoration: InputDecoration(
              labelText: 'Password',
              prefixIcon: const Icon(Icons.lock_outline),
              suffixIcon: IconButton(icon: Icon(_hide ? Icons.visibility : Icons.visibility_off), onPressed: () => setState(() => _hide = !_hide)),
            ),
          ),
          if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, style: const TextStyle(color: AppColors.danger))),
          const Gap(18),
          FilledButton(
            onPressed: _busy ? null : _signIn,
            child: _busy ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Sign in'),
          ),
          const Gap(10),
          TextButton(
            onPressed: () => openLink('${Server.url}/login.html?role=${_role.name}'),
            child: const Text('Forgot password or new teacher / center / school account? Open the website'),
          ),
          if (_role == Role.student) ...[
            const Divider(height: 30),
            OutlinedButton.icon(
              onPressed: () async {
                final code = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => const StudentSignupScreen()));
                if (code != null) setState(() => _identifier.text = code);
              },
              icon: const Icon(Icons.person_add_alt),
              label: const Text('New student? Create an account'),
            ),
          ],
          if (_role == Role.parent) ...[
            const Divider(height: 30),
            OutlinedButton.icon(
              onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ParentSignupScreen())),
              icon: const Icon(Icons.family_restroom),
              label: const Text('New parent? Create an account'),
            ),
          ],
        ]),
      ),
    );
  }
}

class StudentSignupScreen extends StatefulWidget {
  const StudentSignupScreen({super.key});
  @override
  State<StudentSignupScreen> createState() => _StudentSignupScreenState();
}

class _StudentSignupScreenState extends State<StudentSignupScreen> {
  final _form = GlobalKey<FormState>();
  final _first = TextEditingController(), _last = TextEditingController(), _phone = TextEditingController();
  final _parent = TextEditingController(), _school = TextEditingController(), _password = TextEditingController();
  String _grade = '0';
  String? _gender;
  bool _busy = false;
  Map<String, dynamic>? _created;

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    final created = await attempt(context, () async => asMap(await Api.request('POST', '/signup/student', auth: false, body: {
          'firstName': _first.text.trim(),
          'lastName': _last.text.trim(),
          'phone': _phone.text.trim(),
          'parentPhone': _parent.text.trim(),
          'grade': _grade,
          if (_school.text.trim().isNotEmpty) 'schoolName': _school.text.trim(),
          'gender': ?_gender,
          'password': _password.text,
        })));
    if (mounted) setState(() => (_busy = false, _created = created));
  }

  String? _required(String? value) => (value ?? '').trim().isEmpty ? 'Required' : null;

  @override
  Widget build(BuildContext context) {
    final created = _created;
    return Scaffold(
      appBar: AppBar(title: const Text('New student')),
      body: created != null
          ? ListView(padding: const EdgeInsets.all(24), children: [
              const Text('Account created', textAlign: TextAlign.center, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
              const Gap(8),
              const Text('Save your student code. You sign in with it, and show the QR code at the door.', textAlign: TextAlign.center, style: TextStyle(color: AppColors.muted)),
              const Gap(18),
              Center(child: SelectableText('${created['userID']}', style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w900, letterSpacing: 1.5))),
              const Gap(12),
              if (created['qrCode'] is String) Center(child: DataImage(created['qrCode'])),
              const Gap(18),
              FilledButton(onPressed: () => Navigator.pop(context, '${created['userID']}'), child: const Text('Continue to sign in')),
            ])
          : Form(
              key: _form,
              child: ListView(padding: const EdgeInsets.all(20), children: [
                TextFormField(controller: _first, decoration: const InputDecoration(labelText: 'First name'), validator: _required),
                const Gap(),
                TextFormField(controller: _last, decoration: const InputDecoration(labelText: 'Last name'), validator: _required),
                const Gap(),
                TextFormField(controller: _phone, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Your phone'), validator: _required),
                const Gap(),
                TextFormField(controller: _parent, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Parent phone'), validator: _required),
                const Gap(),
                DropdownButtonFormField<String>(
                  initialValue: _grade,
                  decoration: const InputDecoration(labelText: 'Grade'),
                  items: [for (var i = 0; i < grades.length; i++) DropdownMenuItem(value: '$i', child: Text(grades[i]))],
                  onChanged: (value) => _grade = value ?? '0',
                ),
                const Gap(),
                DropdownButtonFormField<String>(
                  initialValue: _gender,
                  decoration: const InputDecoration(labelText: 'Gender (optional)'),
                  items: const [DropdownMenuItem(value: 'male', child: Text('Male')), DropdownMenuItem(value: 'female', child: Text('Female'))],
                  onChanged: (value) => _gender = value,
                ),
                const Gap(),
                TextFormField(controller: _school, decoration: const InputDecoration(labelText: 'School (optional)')),
                const Gap(),
                TextFormField(
                  controller: _password,
                  obscureText: true,
                  decoration: const InputDecoration(labelText: 'Password (8+ characters)'),
                  validator: (value) => (value ?? '').length < 8 ? 'Use at least 8 characters' : null,
                ),
                const Gap(20),
                FilledButton(onPressed: _busy ? null : _submit, child: const Text('Create account')),
              ]),
            ),
    );
  }
}

class ParentSignupScreen extends StatefulWidget {
  const ParentSignupScreen({super.key});
  @override
  State<ParentSignupScreen> createState() => _ParentSignupScreenState();
}

class _ParentSignupScreenState extends State<ParentSignupScreen> {
  final _name = TextEditingController(), _phone = TextEditingController(), _code = TextEditingController(), _password = TextEditingController();
  bool _busy = false;

  Future<void> _submit() async {
    setState(() => _busy = true);
    final done = await attempt(context, () => Api.request('POST', '/signup/parent', auth: false, body: {
          'name': _name.text.trim(),
          'phone': _phone.text.trim(),
          'childCode': _code.text.trim(),
          'password': _password.text,
        }), success: 'Account created. You can sign in now.');
    if (!mounted) return;
    setState(() => _busy = false);
    if (done != null) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('New parent')),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        const Text('Use the phone number your child gave as the parent phone.', style: TextStyle(color: AppColors.muted)),
        const Gap(14),
        TextField(controller: _name, decoration: const InputDecoration(labelText: 'Your name')),
        const Gap(),
        TextField(controller: _phone, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Parent phone')),
        const Gap(),
        TextField(controller: _code, decoration: const InputDecoration(labelText: "Your child's student code (STU-…)")),
        const Gap(),
        TextField(controller: _password, obscureText: true, decoration: const InputDecoration(labelText: 'Password (8+ characters)')),
        const Gap(20),
        FilledButton(onPressed: _busy ? null : _submit, child: const Text('Create account')),
      ]),
    );
  }
}
