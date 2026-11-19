import 'package:educobra_app/services/outbox.dart';
import 'package:flutter_test/flutter_test.dart';

Snap sample() => Snap({
      'at': '2026-11-19T08:00:00.000Z',
      'sessions': [
        {'_id': 's3', 'week': 3, 'number': 3, 'sequence': 'Lesson 3', 'date': '2026-11-19T08:00:00.000Z', 'center': 'c1', 'centerName': 'Nasr', 'price': 50, 'active': true, 'status': 'scheduled'},
        {'_id': 's2', 'week': 2, 'number': 2, 'sequence': 'Lesson 2', 'date': '2026-11-12T08:00:00.000Z', 'center': 'c1', 'centerName': 'Nasr', 'price': 50, 'active': false, 'status': 'done'},
        {'_id': 's1', 'week': 1, 'number': 1, 'sequence': 'Lesson 1', 'date': '2026-11-05T08:00:00.000Z', 'center': 'c1', 'centerName': 'Nasr', 'price': 50, 'active': false, 'status': 'done'},
      ],
      'students': [
        {'_id': 'a', 'userID': 'STU-000123', 'firstName': 'Mona', 'lastName': 'Ali', 'phone': '01012345678', 'parentPhone': '01198765432', 'center': 'c1', 'balance': 100, 'pricePerSession': null, 'isBlocked': false, 'joinedAt': '2026-11-01T00:00:00.000Z'},
        {'_id': 'b', 'userID': 'STU-000124', 'firstName': 'Omar', 'lastName': 'Mostafa', 'phone': '01012340000', 'parentPhone': '', 'center': 'c2', 'balance': 10, 'pricePerSession': 40, 'isBlocked': false},
      ],
      'attendance': [
        ['a', 's1', 'complete', 50],
      ],
    });

void main() {
  test('the number alone and Arabic digits find the code', () {
    expect(normalizeStudentCode('123'), 'STU-000123');
    expect(normalizeStudentCode('stu 123'), 'STU-000123');
    expect(normalizeStudentCode('١٢٣'), 'STU-000123');
    expect(normalizeStudentCode('STU-000123'), 'STU-000123');
    expect(sample().student('123')?['firstName'], 'Mona');
  });

  test('search by part of a phone or a name, same center first', () {
    final snap = sample();
    final byPhone = snap.search('01234');
    expect(byPhone.hits.map((h) => h.code), ['STU-000123', 'STU-000124']);
    expect(byPhone.hits.last.match, 1, reason: 'Omar is in another center than the live session');
    expect(snap.search('+20 119876').hits.single.code, 'STU-000123');
    expect(snap.search('mosta').hits.single.code, 'STU-000124');
    expect(snap.search('124').exactCode, 'STU-000124');
  });

  test('queued work is applied: no double check-in, balance and homework follow', () {
    final snap = sample();
    expect(snap.record('a', 's3'), isNull);
    snap.apply(QueuedOp(id: '1', kind: 'attendance', sessionId: 's3', body: {'identifier': '123', 'payment': 20}, name: 'Mona', at: DateTime.now()));
    expect(snap.record('a', 's3'), isNotNull);
    expect(snap.student('123')!['balance'], 70, reason: '100 + 20 paid - 50 price');
    snap.apply(QueuedOp(id: '2', kind: 'attendance', sessionId: 's3', body: {'identifier': '123', 'payment': 20}, name: 'Mona', at: DateTime.now()));
    expect(snap.student('123')!['balance'], 70, reason: 'the same check-in twice is counted once');
    snap.apply(QueuedOp(id: '3', kind: 'homework', sessionId: 's3', body: {'identifier': '123', 'status': 'incomplete'}, name: 'Mona', at: DateTime.now()));
    snap.apply(QueuedOp(id: '4', kind: 'payment', sessionId: 's3', body: {'identifier': '123', 'amount': 15}, name: 'Mona', at: DateTime.now()));
    expect(snap.record('a', 's3')!['homework'], 'incomplete');
    expect(snap.record('a', 's3')!['paid'], 35);
    expect(snap.student('123')!['balance'], 85);
  });

  test('previous sessions come from the saved copy, without the live one', () {
    final snap = sample();
    final rows = snap.history(snap.student('123')!, except: 's3');
    expect(rows.map((r) => (r['session'] as Map)['_id']), ['s2', 's1']);
    expect(rows.map((r) => r['status']), ['absent', 'present']);
    expect(rows.last['homeworkStatus'], 'complete');
  });
}
