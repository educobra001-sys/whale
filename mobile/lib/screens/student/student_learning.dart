import 'dart:async';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import '../../services/api.dart';
import '../../services/server.dart';
import '../../theme.dart';
import '../../widgets/common.dart';

String accessText(Map<String, dynamic> access) => switch ('${access['state']}') {
      'free' => 'Free lesson',
      'granted' => '${access['viewsLeft']} view(s) left · ${access['startsOnOpen'] == true ? 'time starts on first open' : 'until ${dateTime(access['expiresAt'])}'}',
      'available' => 'Free because you attended · ${access['views']} views for ${access['hours']}h',
      'expired' => 'Your access time ended',
      'exhausted' => 'You used all your views',
      _ => 'Unlock for ${money(access['price'])} · ${access['views']} views for ${access['hours']}h',
    };

Tone accessTone(Map<String, dynamic> access) => switch ('${access['state']}') {
      'free' || 'granted' => Tone.success,
      'available' => Tone.info,
      'expired' || 'exhausted' => Tone.danger,
      _ => Tone.warn,
    };

/// Uploaded files and direct links play inside the app; YouTube, Vimeo and Drive open in their own app.
bool isDirectVideo(String url) => url.startsWith('/files/') || RegExp(r'\.(mp4|webm|m3u8|mov)(\?|$)', caseSensitive: false).hasMatch(url);

class LessonsTab extends StatelessWidget {
  const LessonsTab({super.key, required this.teacherId});
  final String teacherId;

  @override
  Widget build(BuildContext context) {
    return LoadView(
      load: () => Api.cached('/student/teachers/$teacherId/lessons'),
      builder: (context, raw, reload) {
        final lessons = asList(raw);
        if (lessons.isEmpty) return const EmptyState(icon: Icons.ondemand_video, title: 'No lessons yet');
        final weeks = <int, List<Map<String, dynamic>>>{};
        for (final lesson in lessons) {
          weeks.putIfAbsent((lesson['week'] as num?)?.toInt() ?? 0, () => []).add(lesson);
        }
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          for (final week in weeks.keys.toList()..sort()) ...[
            Padding(padding: const EdgeInsets.fromLTRB(4, 8, 4, 8), child: Text('Week $week', style: const TextStyle(fontWeight: FontWeight.w800, color: AppColors.accentText))),
            for (final lesson in weeks[week]!)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Card(
                  child: ListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                    leading: const CircleAvatar(backgroundColor: AppColors.accentSoft, child: Icon(Icons.play_arrow_rounded, color: AppColors.accentText)),
                    title: Text('${lesson['title']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${lesson['partsCount']} part(s) · ${duration(lesson['durationSeconds'])}${(lesson['questionsCount'] ?? 0) > 0 ? ' · ${lesson['questionsCount']} question(s)' : ''}'),
                      const SizedBox(height: 4),
                      Pill(accessText(asMap(lesson['access'])), tone: accessTone(asMap(lesson['access']))),
                    ]),
                    onTap: () async {
                      await Navigator.of(context).push(MaterialPageRoute(builder: (_) => LessonScreen(lessonId: '${lesson['_id']}')));
                      await reload();
                    },
                  ),
                ),
              ),
          ],
        ]);
      },
    );
  }
}

class LessonScreen extends StatefulWidget {
  const LessonScreen({super.key, required this.lessonId});
  final String lessonId;
  @override
  State<LessonScreen> createState() => _LessonScreenState();
}

class _LessonScreenState extends State<LessonScreen> {
  Map<String, dynamic>? _lesson;
  String? _error;
  int _part = 0;
  bool _started = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = asMap(await Api.get('/student/lessons/${widget.lessonId}'));
      setState(() => (_lesson = data, _error = null));
    } on ApiError catch (error) {
      setState(() => _error = error.message);
    }
  }

  Map<String, dynamic> get _access => asMap(_lesson?['access']);
  bool get _open => ['free', 'granted'].contains(_access['state']);
  List<Map<String, dynamic>> get _parts => asList(_lesson?['parts']);

  Future<void> _unlock() async {
    final paying = _access['state'] != 'available';
    if (paying && !await confirm(context, 'Pay ${money(_access['price'] ?? _lesson!['price'])} from your wallet to unlock “${_lesson!['title']}”?', ok: 'Pay')) return;
    if (!mounted) return;
    setState(() => _busy = true);
    final result = await attempt(context, () => Api.post('/student/lessons/${widget.lessonId}/unlock'));
    if (result != null) await _load();
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _start() async {
    if (_access['state'] == 'granted') {
      setState(() => _busy = true);
      final result = await attempt(context, () => Api.post('/student/lessons/${widget.lessonId}/progress', {'start': true}));
      if (mounted) setState(() => _busy = false);
      if (result == null) return;
    }
    setState(() => _started = true);
  }

  @override
  Widget build(BuildContext context) {
    final lesson = _lesson;
    return Scaffold(
      appBar: AppBar(title: Text(lesson == null ? 'Lesson' : '${lesson['title']}')),
      body: lesson == null
          ? (_error == null ? const Center(child: CircularProgressIndicator()) : EmptyState(title: 'Could not open the lesson', text: _error!))
          : ListView(padding: const EdgeInsets.all(16), children: [
              if ('${lesson['description'] ?? ''}'.isNotEmpty) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text('${lesson['description']}')),
              Align(alignment: Alignment.centerLeft, child: Pill(accessText(_access), tone: accessTone(_access))),
              const Gap(),
              if (!_open)
                SectionCard(
                  child: Column(children: [
                    const Icon(Icons.lock_outline, size: 40, color: AppColors.accentDeep),
                    const Gap(8),
                    Text(accessText(_access), textAlign: TextAlign.center),
                    if (!['expired', 'exhausted'].contains(_access['state']) || _access['price'] != null) ...[
                      const Gap(),
                      FilledButton(onPressed: _busy ? null : _unlock, child: Text(_access['state'] == 'available' ? 'Open lesson' : 'Unlock')),
                    ],
                  ]),
                )
              else if (!_started)
                SectionCard(
                  child: Column(children: [
                    const Icon(Icons.play_circle_fill, size: 48, color: AppColors.accentDeep),
                    const Gap(8),
                    Text(_access['state'] == 'granted' ? 'Starting uses 1 of your ${_access['viewsLeft']} remaining views.' : 'This lesson is free — watch as many times as you like.', textAlign: TextAlign.center),
                    const Gap(),
                    FilledButton.icon(onPressed: _busy ? null : _start, icon: const Icon(Icons.play_arrow), label: const Text('Start watching')),
                  ]),
                )
              else ...[
                PartPlayer(
                  key: ValueKey(_parts[_part]['_id']),
                  lessonId: widget.lessonId,
                  part: _parts[_part],
                  resumeAt: (asMap(lesson['resume'])['${_parts[_part]['_id']}'] as num?)?.toInt() ?? 0,
                ),
                const Gap(),
                for (final question in asList(lesson['questions']).where((q) => '${q['part'] ?? ''}' == '${_parts[_part]['_id']}' || '${q['part'] ?? ''}'.isEmpty))
                  Padding(padding: const EdgeInsets.only(bottom: 12), child: QuestionCard(question: question, onAnswered: _load)),
                SectionCard(
                  title: 'Parts',
                  child: Column(children: [
                    for (var i = 0; i < _parts.length; i++)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        selected: i == _part,
                        selectedColor: AppColors.accentText,
                        leading: CircleAvatar(radius: 14, backgroundColor: i == _part ? AppColors.accent : AppColors.accentSoft, child: Text('${i + 1}', style: const TextStyle(fontSize: 12, color: AppColors.ink))),
                        title: Text('${_parts[i]['title']}'),
                        subtitle: Text(duration(_parts[i]['durationSeconds'])),
                        onTap: () => setState(() => _part = i),
                      ),
                  ]),
                ),
              ],
            ]),
    );
  }
}

/// Plays one part. Direct videos play here, resume where the student stopped (never at the very end)
/// and report watch time every 30 seconds and when the part closes.
class PartPlayer extends StatefulWidget {
  const PartPlayer({super.key, required this.lessonId, required this.part, required this.resumeAt});
  final String lessonId;
  final Map<String, dynamic> part;
  final int resumeAt;
  @override
  State<PartPlayer> createState() => _PartPlayerState();
}

class _PartPlayerState extends State<PartPlayer> {
  VideoPlayerController? _controller;
  Timer? _timer;
  int _lastSent = 0;
  String? _error;

  String get _url => '${widget.part['url'] ?? ''}';

  @override
  void initState() {
    super.initState();
    if (_url.isNotEmpty && isDirectVideo(_url)) _init();
  }

  Future<void> _init() async {
    final controller = VideoPlayerController.networkUrl(Uri.parse(Server.file(_url)));
    _controller = controller;
    try {
      await controller.initialize();
      final length = controller.value.duration.inSeconds;
      if (widget.resumeAt > 0 && (length == 0 || widget.resumeAt < length - 5)) {
        await controller.seekTo(Duration(seconds: widget.resumeAt));
        _lastSent = widget.resumeAt;
      }
      _timer = Timer.periodic(const Duration(seconds: 30), (_) => _report());
      if (mounted) setState(() {});
    } catch (_) {
      if (mounted) setState(() => _error = 'This video could not be played.');
    }
  }

  void _report() {
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized) return;
    final seconds = controller.value.position.inSeconds;
    if (seconds <= _lastSent) return;
    _lastSent = seconds;
    Api.post('/student/lessons/${widget.lessonId}/progress', {'part': '${widget.part['_id']}', 'seconds': seconds}).catchError((_) => null);
  }

  @override
  void dispose() {
    _timer?.cancel();
    _report();
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_url.isEmpty) return const SectionCard(child: Text('This video is not available.'));
    if (!isDirectVideo(_url)) {
      return SectionCard(
        child: Column(children: [
          const Icon(Icons.smart_display, size: 48, color: AppColors.accentDeep),
          const Gap(8),
          Text('${widget.part['title']}', style: const TextStyle(fontWeight: FontWeight.w700)),
          const Text('This video plays in its own app (YouTube, Vimeo or Drive).', textAlign: TextAlign.center, style: TextStyle(color: AppColors.muted)),
          const Gap(),
          FilledButton.icon(
            onPressed: () {
              Api.post('/student/lessons/${widget.lessonId}/progress', {'part': '${widget.part['_id']}', 'seconds': widget.part['durationSeconds'] ?? 0}).catchError((_) => null);
              openLink(_url);
            },
            icon: const Icon(Icons.open_in_new),
            label: const Text('Watch video'),
          ),
        ]),
      );
    }
    final controller = _controller;
    if (_error != null) return SectionCard(child: Text(_error!));
    if (controller == null || !controller.value.isInitialized) {
      return const AspectRatio(aspectRatio: 16 / 9, child: ColoredBox(color: Colors.black, child: Center(child: CircularProgressIndicator())));
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: ColoredBox(
        color: Colors.black,
        child: Column(children: [
          AspectRatio(aspectRatio: controller.value.aspectRatio, child: VideoPlayer(controller)),
          VideoProgressIndicator(controller, allowScrubbing: true, colors: const VideoProgressColors(playedColor: AppColors.accent)),
          ValueListenableBuilder(
            valueListenable: controller,
            builder: (context, value, _) => Row(children: [
              IconButton(
                color: Colors.white,
                icon: Icon(value.isPlaying ? Icons.pause : Icons.play_arrow),
                onPressed: () {
                  if (value.isPlaying) {
                    controller.pause();
                    _report();
                  } else {
                    controller.play();
                  }
                },
              ),
              IconButton(color: Colors.white, icon: const Icon(Icons.replay_10), onPressed: () => controller.seekTo(value.position - const Duration(seconds: 10))),
              IconButton(color: Colors.white, icon: const Icon(Icons.forward_10), onPressed: () => controller.seekTo(value.position + const Duration(seconds: 10))),
              const Spacer(),
              Padding(
                padding: const EdgeInsets.only(right: 12),
                child: Text('${_clock(value.position)} / ${_clock(value.duration)}', style: const TextStyle(color: Colors.white70, fontSize: 12)),
              ),
            ]),
          ),
        ]),
      ),
    );
  }

  String _clock(Duration d) => '${d.inMinutes.toString().padLeft(2, '0')}:${(d.inSeconds % 60).toString().padLeft(2, '0')}';
}

class QuestionCard extends StatefulWidget {
  const QuestionCard({super.key, required this.question, required this.onAnswered});
  final Map<String, dynamic> question;
  final Future<void> Function() onAnswered;
  @override
  State<QuestionCard> createState() => _QuestionCardState();
}

class _QuestionCardState extends State<QuestionCard> {
  bool _busy = false;

  Future<void> _answer(Map<String, dynamic> body) async {
    setState(() => _busy = true);
    final result = await attempt(context, () => Api.post('/student/questions/${widget.question['_id']}/answer', body));
    if (mounted) setState(() => _busy = false);
    if (result != null) await widget.onAnswered();
  }

  Future<void> _essay() async {
    final picked = await FilePicker.pickFiles(type: FileType.image);
    final path = picked.firstOrNull?.path;
    if (path == null || !mounted) return;
    setState(() => _busy = true);
    final url = await attempt(context, () => Api.upload(path));
    if (mounted) setState(() => _busy = false);
    if (url != null) await _answer({'imageUrl': url});
  }

  @override
  Widget build(BuildContext context) {
    final q = widget.question;
    final answer = asMap(q['answer']);
    final options = [for (final option in (q['options'] as List? ?? const [])) '$option'];
    return SectionCard(
      title: 'Question · ${q['bonusPoints'] ?? 0} points',
      color: AppColors.accentSoft,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('${q['text'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
        if ('${q['imageUrl'] ?? ''}'.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Image.network(Server.file('${q['imageUrl']}'))),
        const Gap(10),
        if (q['type'] == 'essay')
          answer.isEmpty
              ? OutlinedButton.icon(onPressed: _busy ? null : _essay, icon: const Icon(Icons.photo_camera), label: const Text('Send a photo of your answer'))
              : Pill(answer['status'] == 'pending' ? 'Sent — waiting for your teacher' : (answer['isCorrect'] == true ? 'Correct · +${answer['points']}' : 'Not correct'),
                  tone: answer['status'] == 'pending' ? Tone.warn : (answer['isCorrect'] == true ? Tone.success : Tone.danger))
        else ...[
          for (final option in options)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: OutlinedButton(
                style: OutlinedButton.styleFrom(
                  alignment: Alignment.centerLeft,
                  backgroundColor: answer.isEmpty
                      ? Colors.white
                      : (option == (q['correct'] ?? '')
                          ? AppColors.successSoft
                          : (option == answer['choice'] ? AppColors.dangerSoft : Colors.white)),
                ),
                onPressed: answer.isEmpty && !_busy ? () => _answer({'choice': option}) : null,
                child: Text(option),
              ),
            ),
          if (answer.isNotEmpty) Pill(answer['isCorrect'] == true ? 'Correct! +${answer['points']} points' : 'Not quite — the correct answer is green', tone: answer['isCorrect'] == true ? Tone.success : Tone.danger),
        ],
      ]),
    );
  }
}

class HomeworkTab extends StatelessWidget {
  const HomeworkTab({super.key, required this.teacherId});
  final String teacherId;

  @override
  Widget build(BuildContext context) {
    return LoadView(
      load: () => Api.cached('/student/teachers/$teacherId/homework'),
      builder: (context, raw, reload) {
        final list = asList(raw);
        if (list.isEmpty) return const EmptyState(icon: Icons.edit_note, title: 'No homework yet');
        return Column(children: [
          for (final hw in list)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: SectionCard(
                title: '${hw['title']}',
                trailing: _status(hw),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  if ('${hw['description'] ?? ''}'.isNotEmpty) Text('${hw['description']}'),
                  Text('${date(hw['startDate'])} → ${date(hw['endDate'])}', style: const TextStyle(color: AppColors.muted, fontSize: 13)),
                  if ('${asMap(hw['submission'])['feedback'] ?? ''}'.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Text('Feedback: ${asMap(hw['submission'])['feedback']}')),
                  if ('${hw['externalLink'] ?? ''}'.isNotEmpty) TextButton.icon(onPressed: () => openLink('${hw['externalLink']}'), icon: const Icon(Icons.link), label: const Text('Open the homework link')),
                  if (hw['isOpen'] == true && (hw['submission'] == null || asMap(hw['submission'])['status'] == 'submitted'))
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: OutlinedButton.icon(
                        onPressed: () async {
                          final sent = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => SubmitHomework(homework: hw)));
                          if (sent == true) await reload();
                        },
                        icon: const Icon(Icons.upload_file),
                        label: Text(hw['submission'] == null ? 'Submit' : 'Change my submission'),
                      ),
                    ),
                ]),
              ),
            ),
        ]);
      },
    );
  }

  Widget _status(Map<String, dynamic> hw) {
    final sub = asMap(hw['submission']);
    if (sub.isNotEmpty) return Pill(homeworkLabel(sub['status']).isEmpty ? '${sub['status']}' : homeworkLabel(sub['status']), tone: homeworkTone(sub['status']));
    return hw['isOpen'] == true ? const Pill('Open', tone: Tone.info) : const Pill('Closed');
  }
}

class SubmitHomework extends StatefulWidget {
  const SubmitHomework({super.key, required this.homework});
  final Map<String, dynamic> homework;
  @override
  State<SubmitHomework> createState() => _SubmitHomeworkState();
}

class _SubmitHomeworkState extends State<SubmitHomework> {
  final _files = <String>[];
  final _comment = TextEditingController();
  final _link = TextEditingController();
  bool _busy = false;

  Future<void> _add() async {
    final picked = await FilePicker.pickFiles(type: FileType.custom, allowedExtensions: ['jpg', 'jpeg', 'png', 'webp', 'pdf']);
    if (picked.isEmpty || !mounted) return;
    setState(() => _busy = true);
    for (final file in picked) {
      if (file.path == null) continue;
      final url = await attempt(context, () => Api.upload(file.path!));
      if (url != null) _files.add(url);
    }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _send() async {
    setState(() => _busy = true);
    final done = await attempt(context, () => Api.post('/student/homework/${widget.homework['_id']}/submit', {
          'files': _files,
          if (_comment.text.trim().isNotEmpty) 'comment': _comment.text.trim(),
          if (_link.text.trim().isNotEmpty) 'link': _link.text.trim(),
        }), success: 'Homework sent.');
    if (!mounted) return;
    setState(() => _busy = false);
    if (done != null) Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    final upload = widget.homework['submissionType'] != 'link';
    return Scaffold(
      appBar: AppBar(title: Text('${widget.homework['title']}')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        if (upload) ...[
          OutlinedButton.icon(onPressed: _busy ? null : _add, icon: const Icon(Icons.add_photo_alternate), label: const Text('Add photos or PDF')),
          const Gap(8),
          for (final file in _files)
            ListTile(
              leading: const Icon(Icons.insert_drive_file),
              title: Text(file.split('/').last, overflow: TextOverflow.ellipsis),
              trailing: IconButton(icon: const Icon(Icons.close), onPressed: () => setState(() => _files.remove(file))),
            ),
        ] else
          TextField(controller: _link, keyboardType: TextInputType.url, decoration: const InputDecoration(labelText: 'Link to your work (https://…)')),
        const Gap(),
        TextField(controller: _comment, maxLines: 3, decoration: const InputDecoration(labelText: 'Comment (optional)')),
        const Gap(20),
        FilledButton(onPressed: _busy || (upload && _files.isEmpty) ? null : _send, child: _busy ? const CircularProgressIndicator() : const Text('Send homework')),
      ]),
    );
  }
}
