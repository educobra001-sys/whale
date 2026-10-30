// import { Server } from "socket.io";
// import { TokenService } from "../../common/service/token";
// import { BadRequestError } from "../../common/exceptions/error.exceptions";
// import { chatgateway } from "../chat/realtime/realtimeChat.gateway";
// import { redisService, RedisService } from "../../common/service/redisService";

// class RealTimeGateWay {
//   private tokenservice: TokenService;
//   private redisservice: RedisService
//   constructor() {
//     this.tokenservice = new TokenService();
//     this.redisservice = redisService
//   }

//   // Bound arrow function preserves `this.tokenservice`
//   authenticate = async (socket: any, next: any) => {
//     try {
//       const rawToken = socket.handshake.auth?.token;

//       if (!rawToken) {
//         return next(new BadRequestError('Authentication token missing'));
//       }

//       // Remove 'Bearer ' prefix if present
//       const token = rawToken.startsWith('Bearer ') 
//         ? rawToken.slice(7) 
//         : rawToken;

//       const decoded = this.tokenservice.decodeToken(token);

//       if (!decoded) {
//         return next(new BadRequestError('Invalid token'));
//       }

//       socket.data = decoded;
//       next();
//     } catch (error) {
//       next(error as Error);
//     }
//   };

//   initializer(httpServer: any) {
//     const io = new Server(httpServer, {
//       cors: {
//         origin: '*',
//       },
//     });

//     io.use(this.authenticate);

//     io.on('connection', async (socket) => {
//       console.log(`User connected with ID: ${socket.data.id || socket.data._id}`);
//       await this.redisservice.addSocket(socket.data.id,socket.id)
//       socket.on('disconnect', async () => {
//         console.log(`Socket disconnected: ${socket.id}`);
//         await this.redisservice.removeSocket(socket.data.id,socket.id)
//       });

//       socket.on('start', (data, callback) => {
//         console.log(data);
//         if (typeof callback === 'function') {
//           callback('received from start');
//         }
//         io.emit('send', 'send from send');
//       });

//       chatgateway.register(socket, io);
//     });
//   }
// }

// export const realTimeGateway = new RealTimeGateWay();