import 'package:educobra_app/screens/staff/staff_messages.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('phone numbers follow the same rules as the server', () {
    for (final ok in ['01012345678', '1012345678', '+20 101 234 5678', '00201012345678', '٠١٠١٢٣٤٥٦٧٨', '966512345678']) {
      expect(phoneProblem(ok), isNull, reason: ok);
    }
    expect(phoneProblem('0101234567'), startsWith('Wrong length'));
    expect(phoneProblem('01312345678'), 'Egyptian mobiles start with 010, 011, 012 or 015');
    expect(phoneProblem('12345'), 'Too short to be a phone number');
    expect(phoneProblem(''), 'No phone number');
  });

  test('templates fill known fields and keep unknown ones', () {
    expect(renderTemplate('Hi {first_name}, {unknown}', {'first_name': 'Mona'}), 'Hi Mona, {unknown}');
  });
}
