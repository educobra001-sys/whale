import 'staff_messages.dart';
import 'package:flutter/material.dart';

import '../../services/account.dart';
import '../../services/api.dart';
import '../../services/server.dart';
import '../../theme.dart';
import '../../widgets/common.dart';
import '../home_router.dart';

class StaffMore extends StatelessWidget {
  const StaffMore({super.key, required this.account});
  final Account account;

  @override
  Widget build(BuildContext context) {
    final a = account;
    void open(String title, Widget body) => Navigator.of(context).push(MaterialPageRoute(builder: (_) => Scaffold(appBar: AppBar(title: Text(title)), body: body)));
    final items = <(IconData, String, VoidCallback)>[
      if (a.can('messages')) (Icons.forum_outlined, 'Messages', () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const StaffMessages()))),
      if (a.has('lessons') && a.can('lessons')) (Icons.ondemand_video, 'Video lessons', () => open('Video lessons', const StaffLessons())),
      if (a.has('exams') && a.can('exams')) (Icons.workspace_premium_outlined, 'Exams & scores', () => open('Exams', const StaffExams())),
      if (a.has('homework') && a.can('homework_online')) (Icons.edit_note, 'Online homework', () => open('Online homework', const StaffHomework())),
      (Icons.language, 'Open the full website', () => openLink('${Server.url}/login.html?role=${a.role.name}')),
      (Icons.person_outline, 'Account', () => open('Account', AccountScreen(account: a))),
    ];
    return ListView(padding: const EdgeInsets.all(16), children: [
      for (final (icon, title, onTap) in items)
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Card(child: ListTile(leading: Icon(icon, color: AppColors.accentText), title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700)), trailing: const Icon(Icons.chevron_right), onTap: onTap)),
        ),
      const Text('Finance, assistants and other settings are on the website.', textAlign: TextAlign.center, style: TextStyle(color: AppColors.muted, fontSize: 12.5)),
    ]);
  }
}

class StaffLessons extends StatelessWidget {
  const StaffLessons({super.key});
  @override
  Widget build(BuildContext context) {
    return LoadView(
      load: () => Api.cached('/teacher/lessons'),
      builder: (context, raw, reload) {
        final lessons = asList(raw);
        if (lessons.isEmpty) return const EmptyState(icon: Icons.ondemand_video, title: 'No lessons yet', text: 'Create lessons on the website.');
        return Column(children: [
          for (final lesson in lessons)
            Card(
              margin: const EdgeInsets.only(bottom: 8),
              child: SwitchListTile(
                value: lesson['published'] == true,
                activeThumbColor: AppColors.accentDeep,
                title: Text('Week ${lesson['week']} · ${lesson['title']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text('${asList(lesson['parts']).length} part(s) · ${lesson['isFree'] == true ? 'free' : money(lesson['price'])} · ${asMap(lesson['stats'])['viewers'] ?? 0} viewer(s)'
                    '${(asMap(lesson['stats'])['pendingAnswers'] ?? 0) > 0 ? ' · ${asMap(lesson['stats'])['pendingAnswers']} answer(s) to grade' : ''}'),
                onChanged: (value) async {
                  final done = await attempt(context, () => Api.patch('/teacher/lessons/${lesson['_id']}', {'published': value}), success: value ? 'Visible to students.' : 'Hidden from students.');
                  if (done != null) await reload();
                },
              ),
            ),
        ]);
      },
    );
  }
}

class StaffExams extends StatefulWidget {
  const StaffExams({super.key});
  @override
  State<StaffExams> createState() => _StaffExamsState();
}

class _StaffExamsState extends State<StaffExams> {
  int _version = 0;

  Future<void> _create() async {
    final name = TextEditingController(), max = TextEditingController(text: '50');
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('New exam'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: name, decoration: const InputDecoration(labelText: 'Name')),
          const Gap(8),
          TextField(controller: max, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Full mark')),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Create')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    final done = await attempt(context, () => Api.post('/teacher/exams', {'name': name.text.trim(), 'maxScore': num.tryParse(max.text.trim()) ?? 0}), success: 'Exam created.');
    if (done != null) setState(() => _version++);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      floatingActionButton: FloatingActionButton(backgroundColor: AppColors.accent, onPressed: _create, child: const Icon(Icons.add)),
      body: LoadView(
        key: ValueKey(_version),
        load: () => Api.cached('/teacher/exams'),
        builder: (context, raw, reload) {
          final exams = asList(raw);
          if (exams.isEmpty) return const EmptyState(icon: Icons.workspace_premium_outlined, title: 'No exams yet');
          return Column(children: [
            for (final exam in exams)
              Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  title: Text('${exam['name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text('${date(exam['date'])} · full mark ${exam['maxScore']} · ${asMap(exam['stats'])['count'] ?? 0} score(s) · average ${asMap(exam['stats'])['avg'] ?? 0}'),
                  trailing: const Icon(Icons.edit),
                  onTap: () async {
                    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => ExamScoresScreen(examId: '${exam['_id']}')));
                    await reload();
                  },
                ),
              ),
          ]);
        },
      ),
    );
  }
}

class ExamScoresScreen extends StatefulWidget {
  const ExamScoresScreen({super.key, required this.examId});
  final String examId;
  @override
  State<ExamScoresScreen> createState() => _ExamScoresScreenState();
}

class _ExamScoresScreenState extends State<ExamScoresScreen> {
  Map<String, dynamic>? _exam;
  List<Map<String, dynamic>> _students = [];
  final _scores = <String, TextEditingController>{};
  final _search = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final exam = asMap(await Api.get('/teacher/exams/${widget.examId}'));
      final students = asList(await Api.get('/teacher/myStudents'));
      final grade = '${exam['grade'] ?? ''}';
      final results = {for (final row in asList(exam['results'])) '${row['student']}': row['score']};
      setState(() {
        _exam = exam;
        _students = grade.isEmpty ? students : students.where((s) => '${s['grade']}' == grade).toList();
        for (final s in _students) {
          final score = results['${s['_id']}'];
          _scores['${s['_id']}'] = TextEditingController(text: score == null ? '' : '$score');
        }
      });
    } on ApiError catch (error) {
      setState(() => _error = error.message);
    }
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    final scores = [
      for (final entry in _scores.entries) {'student': entry.key, 'score': entry.value.text.trim().isEmpty ? null : num.tryParse(entry.value.text.trim())},
    ];
    final done = await attempt(context, () => Api.put('/teacher/exams/${widget.examId}/scores', {'scores': scores}), success: 'Scores saved.');
    if (!mounted) return;
    setState(() => _busy = false);
    if (done != null) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final exam = _exam;
    final q = _search.text.trim().toLowerCase();
    final shown = _students.where((s) => q.isEmpty || '${fullName(s)} ${s['userID']}'.toLowerCase().contains(q)).toList();
    return Scaffold(
      appBar: AppBar(title: Text(exam == null ? 'Exam' : '${exam['name']}'), actions: [if (exam != null) TextButton(onPressed: _busy ? null : _save, child: const Text('Save'))]),
      body: exam == null
          ? (_error == null ? const Center(child: CircularProgressIndicator()) : EmptyState(title: 'Could not open the exam', text: _error!))
          : ListView(padding: const EdgeInsets.all(16), children: [
              Text('Full mark ${exam['maxScore']}. Leave a box empty for "no score".', style: const TextStyle(color: AppColors.muted)),
              const Gap(8),
              TextField(controller: _search, onChanged: (_) => setState(() {}), decoration: const InputDecoration(hintText: 'Find a student', prefixIcon: Icon(Icons.search))),
              const Gap(8),
              for (final s in shown)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(children: [
                    Expanded(child: Text('${fullName(s)}\n${s['userID']}', style: const TextStyle(fontSize: 13.5))),
                    SizedBox(
                      width: 90,
                      child: TextField(controller: _scores['${s['_id']}'], keyboardType: const TextInputType.numberWithOptions(decimal: true), textAlign: TextAlign.center, decoration: const InputDecoration(contentPadding: EdgeInsets.all(10))),
                    ),
                  ]),
                ),
              const Gap(),
              FilledButton(onPressed: _busy ? null : _save, child: const Text('Save scores')),
            ]),
    );
  }
}

class StaffHomework extends StatelessWidget {
  const StaffHomework({super.key});
  @override
  Widget build(BuildContext context) {
    return LoadView(
      load: () => Api.cached('/teacher/homework'),
      builder: (context, raw, reload) {
        final list = asList(raw);
        if (list.isEmpty) return const EmptyState(icon: Icons.edit_note, title: 'No homework yet', text: 'Create homework on the website.');
        return Column(children: [
          for (final hw in list)
            Card(
              margin: const EdgeInsets.only(bottom: 8),
              child: ListTile(
                title: Text('${hw['title']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text('Due ${date(hw['endDate'])} · ${hw['submissionsCount'] ?? 0} submitted'),
                trailing: (hw['pendingCount'] ?? 0) > 0 ? Pill('${hw['pendingCount']} to grade', tone: Tone.warn) : const Icon(Icons.chevron_right),
                onTap: () async {
                  await Navigator.of(context).push(MaterialPageRoute(builder: (_) => SubmissionsScreen(homework: hw)));
                  await reload();
                },
              ),
            ),
        ]);
      },
    );
  }
}

class SubmissionsScreen extends StatelessWidget {
  const SubmissionsScreen({super.key, required this.homework});
  final Map<String, dynamic> homework;
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('${homework['title']}')),
      body: LoadView(
        load: () async => Loaded(await Api.get('/teacher/homework/${homework['_id']}/submissions')),
        builder: (context, raw, reload) {
          final subs = asList(asMap(raw)['submissions']);
          if (subs.isEmpty) return const EmptyState(icon: Icons.inbox_outlined, title: 'No submissions yet');
          return Column(children: [
            for (final sub in subs)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: SectionCard(
                  title: fullName(sub['student']),
                  trailing: Pill(homeworkLabel(sub['status']).isEmpty ? '${sub['status']}' : homeworkLabel(sub['status']), tone: homeworkTone(sub['status'])),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Text(dateTime(sub['submittedAt']), style: const TextStyle(color: AppColors.muted)),
                    if ('${sub['comment'] ?? ''}'.isNotEmpty) Text('${sub['comment']}'),
                    Wrap(spacing: 6, children: [
                      for (final (index, file) in (sub['files'] as List? ?? const []).indexed)
                        ActionChip(avatar: const Icon(Icons.attach_file, size: 16), label: Text('File ${index + 1}'), onPressed: () => openLink(Server.file('$file'))),
                      if ('${sub['link'] ?? ''}'.isNotEmpty) ActionChip(avatar: const Icon(Icons.link, size: 16), label: const Text('Link'), onPressed: () => openLink('${sub['link']}')),
                    ]),
                    const Gap(6),
                    Wrap(spacing: 6, runSpacing: 6, children: [
                      for (final status in ['complete', 'incomplete', 'no_steps', 'not_done'])
                        OutlinedButton(
                          onPressed: () async {
                            final done = await attempt(context, () => Api.patch('/teacher/homework/submissions/${sub['_id']}', {'status': status}));
                            if (done != null) await reload();
                          },
                          child: Text(homeworkLabel(status)),
                        ),
                    ]),
                  ]),
                ),
              ),
          ]);
        },
      ),
    );
  }
}
