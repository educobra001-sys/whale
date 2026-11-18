import 'package:educobra_app/services/server.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('server addresses typed in different ways become one base URL', () {
    expect(Server.normalize('192.168.1.20'), 'http://192.168.1.20:4000');
    expect(Server.normalize('192.168.1.20:4000'), 'http://192.168.1.20:4000');
    expect(Server.normalize(' http://192.168.1.20:5000/ '), 'http://192.168.1.20:5000');
    expect(Server.normalize('https://abc-def.trycloudflare.com'), 'https://abc-def.trycloudflare.com');
    expect(Server.normalize('educobra://connect?url=http%3A%2F%2F10.0.0.5%3A4000'), 'http://10.0.0.5:4000');
    expect(Server.normalize(''), '');
  });

  test('online addresses default to https', () {
    expect(Server.normalize('educobra.vercel.app'), 'https://educobra.vercel.app');
    expect(Server.normalize('EduCobra.Vercel.app/'), 'https://educobra.vercel.app');
    expect(Server.normalize('https://educobra.vercel.app/login.html'), 'https://educobra.vercel.app');
    expect(Server.normalize('localhost'), 'http://localhost:4000');
    expect(Server.normalize('mypc.local:4000'), 'http://mypc.local:4000');
  });
}
