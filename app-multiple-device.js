const { Client, MessageMedia, LegacySessionAuth, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const socketIO = require('socket.io');
const qrcode = require('qrcode');
const http = require('http');
const fs = require('fs');
const { phoneNumberFormatter } = require('./helpers/formatter');
const axios = require('axios');
const port = process.env.PORT || 8000;

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const SECRET_TOKEN = 'fkam_service';

app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));

app.get('/', (req, res) => {
  res.sendFile('index-multiple-device.html', {
    root: __dirname
  });
});

const sessions = [];
const SESSIONS_FILE = './whatsapp-sessions.json';

const createSessionsFileIfNotExists = function () {
  if (!fs.existsSync(SESSIONS_FILE)) {
    try {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify([]));
      console.log('Sessions file created successfully.');
    } catch (err) {
      console.log('Failed to create sessions file: ', err);
    }
  }
}

createSessionsFileIfNotExists();

const setSessionsFile = function (sessions) {
  fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions), function (err) {
    if (err) {
      console.log(err);
    }
  });
}

const getSessionsFile = function () {
  return JSON.parse(fs.readFileSync(SESSIONS_FILE));
}

const createSession = function (id, description, token) {
  console.log('Creating session: ' + id);
  const SESSION_FILE_PATH = `./whatsapp-session-${id}.json`;
  let sessionCfg;
  if (fs.existsSync(SESSION_FILE_PATH)) {
    sessionCfg = require(SESSION_FILE_PATH);
  }

  // const client = new Client({
  //   authStrategy: new LocalAuth({
  //     dataPath: 'whatsapp-sessions.json'
  //   }),
  //   restartOnAuthFail: true,
  //   session: sessionCfg,
  //   puppeteer: {
  //     headless: true,
  //     args: [
  //       '--no-sandbox',
  //       '--disable-setuid-sandbox',
  //       '--disable-dev-shm-usage',
  //       '--disable-accelerated-2d-canvas',
  //       '--no-first-run',
  //       '--no-zygote',
  //       '--single-process', // <- this one doesn't works in Windows
  //       '--disable-gpu'
  //     ],
  //   },
  // });

  const authStrategy = new LegacySessionAuth({
    session: sessionCfg,
    restartOnAuthFail: false
  })

  const client = new Client({
    authStrategy: authStrategy,
    restartOnAuthFail: true,
    session: sessionCfg,
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process', // <- this one doesn't works in Windows
        '--disable-gpu'
      ],
    },
  });

  client.initialize();

  client.on('message', msg => {
    if (msg.body == '!ping') {
      msg.reply('pong');
    } else if (msg.body == 'good morning') {
      msg.reply('selamat pagi');
    } else if (msg.body == '!groups') {
      client.getChats().then(chats => {
        const groups = chats.filter(chat => chat.isGroup);

        if (groups.length == 0) {
          msg.reply('You have no group yet.');
        } else {
          let replyMsg = '*YOUR GROUPS*\n\n';
          groups.forEach((group, i) => {
            replyMsg += `ID: ${group.id._serialized}\nName: ${group.name}\n\n`;
          });
          replyMsg += '_You can use the group id to send a message to the group._'
          msg.reply(replyMsg);
        }
      });
    }
  });


  client.on('qr', (qr) => {
    console.log('QR RECEIVED', qr);
    qrcode.toDataURL(qr, (err, url) => {
      io.emit('qr', { id: id, src: url });
      io.emit('message', { id: id, text: 'QR Code received, scan please!' });
    });
  });

  client.on('ready', () => {
    io.emit('ready', { id: id });
    io.emit('message', { id: id, text: 'Whatsapp is ready!' });

    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions[sessionIndex].ready = true;
    setSessionsFile(savedSessions);
  });

  client.on('authenticated', (session) => {
    io.emit('authenticated', { id: id });
    io.emit('message', { id: id, text: 'Whatsapp is authenticated!' });
    sessionCfg = session;
    fs.writeFile(SESSION_FILE_PATH, JSON.stringify(session), function (err) {
      if (err) {
        console.error(err);
      }
    });
  });

  client.on('auth_failure', function (session) {
    io.emit('message', { id: id, text: 'Auth failure, restarting...' });
  });

  client.on('disconnected', (reason) => {
    io.emit('message', { id: id, text: 'Whatsapp is disconnected!' });

    try {
      fs.unlinkSync(SESSION_FILE_PATH, function (err) {
        if (err) {
          console.log(err)
        };
        console.log('Session file deleted!');
      });
    } catch (error) {
      console.log(`gagal menghapus file whatsapp-session-${id}.json`);
    }

    client.destroy();
    client.initialize();

    // Menghapus pada file sessions
    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions.splice(sessionIndex, 1);
    setSessionsFile(savedSessions);

    io.emit('remove-session', id);
  });

  // Tambahkan client ke sessions
  sessions.push({
    id: id,
    description: description,
    client: client
  });

  // Menambahkan session ke file
  const savedSessions = getSessionsFile();
  const sessionIndex = savedSessions.findIndex(sess => sess.id == id);

  if (sessionIndex == -1) {
    savedSessions.push({
      id: id,
      description: description,
      ready: false,
    });
    setSessionsFile(savedSessions);
  }
}

const removeSession = function (id, token) {
  if (token === SECRET_TOKEN) {
    const SESSION_FILE_PATH = `./whatsapp-session-${id}.json`;
    try {
      fs.unlinkSync(SESSION_FILE_PATH, function (err) {
        if (err) {
          console.log(err)
        };
        console.log('Session file deleted!');
      });
    } catch (error) {
      console.log(`gagal menghapus file whatsapp-session-${id}.json`);
    }


    // Menghapus pada file sessions
    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions.splice(sessionIndex, 1);
    setSessionsFile(savedSessions);

    io.emit('remove-session', { id: id, status: true, message: 'success' });
  } else {
    io.emit('remove-session', { id: id, status: false, message: 'failed' });
    console.log('Invalid token nih');
  }
}

const init = function (socket) {
  const savedSessions = getSessionsFile();

  if (savedSessions.length > 0) {
    if (socket) {
      socket.emit('init', savedSessions);
    } else {
      savedSessions.forEach(sess => {
        createSession(sess.id, sess.description, sess.token);
      });
    }
  }
}

init();

// Socket IO
io.on('connection', function (socket) {
  init(socket);

  socket.on('create-session', function (data) {
    console.log('Create session: ' + data.id);
    if (data.token === SECRET_TOKEN) {
      createSession(data.id, data.description, data.token);
    } else {
      console.log('Invalid create session');
    }
  });

  socket.on('delete-session', function (data) {
    console.log('Delete session: ' + data.id);
    if (data.token === SECRET_TOKEN) {
      removeSession(data.id, data.token);
    } else {
      io.emit('remove-session', { id: data.id, status: false, message: 'failed' });
      console.log('invalid delete session');
    }
  })
});

// io.on('connection', function(socket) {
//   socket.emit('message', 'Connecting...');

//   client.on('qr', (qr) => {
//     console.log('QR RECEIVED', qr);
//     qrcode.toDataURL(qr, (err, url) => {
//       socket.emit('qr', url);
//       socket.emit('message', 'QR Code received, scan please!');
//     });
//   });

//   client.on('ready', () => {
//     socket.emit('ready', 'Whatsapp is ready!');
//     socket.emit('message', 'Whatsapp is ready!');
//   });

//   client.on('authenticated', (session) => {
//     socket.emit('authenticated', 'Whatsapp is authenticated!');
//     socket.emit('message', 'Whatsapp is authenticated!');
//     console.log('AUTHENTICATED', session);
//     sessionCfg = session;
//     fs.writeFile(SESSION_FILE_PATH, JSON.stringify(session), function(err) {
//       if (err) {
//         console.error(err);
//       }
//     });
//   });

//   client.on('auth_failure', function(session) {
//     socket.emit('message', 'Auth failure, restarting...');
//   });

//   client.on('disconnected', (reason) => {
//     socket.emit('message', 'Whatsapp is disconnected!');
//     fs.unlinkSync(SESSION_FILE_PATH, function(err) {
//         if(err) return console.log(err);
//         console.log('Session file deleted!');
//     });
//     client.destroy();
//     client.initialize();
//   });
// });

// Send message
app.post('/send-message', async (req, res) => {
  const token = req.header('x-token');

  if (token !== SECRET_TOKEN) {
    return res.status(401).json({
      status: false,
      message: 'Unauthenticated'
    })
  }

  const sender = req.body.sender;
  const number = await phoneNumberFormatter(req.body.number);
  const message = req.body.message;

  const client = await sessions.find(sess => sess.id === sender).client;
  console.log("client object => ", client);

  const checkRegisteredNumber = async function (number) {
    const isRegistered = await client.isRegisteredUser(number);
    return isRegistered;
  }

  const isRegisteredNumber = await checkRegisteredNumber(number);

  if (!isRegisteredNumber) {
    return res.status(422).json({
      status: false,
      message: 'The number is not registered'
    });
  }

  client.sendMessage(number, message).then(response => {
    res.status(200).json({
      status: true,
      response: response
    });
  }).catch(err => {
    res.status(500).json({
      status: false,
      response: err
    });
  });
});

// // Send message bc
// app.post('/send-message-bc',async (req, res) => {
//   const token = req.header('x-token');

//   if (token !== SECRET_TOKEN) {
//     return res.status(401).json({
//       status: false,
//       message: 'Unauthenticated'
//     })  
//   }

//   const sender = req.body.sender;
//   // const number = phoneNumberFormatter(req.body.number);
//   // const message = req.body.message;
//   const data = req.body.data;

//   const client = await sessions.find(sess => sess.id === sender).client;

//   const checkRegisteredNumber = async function(number) {
//     const isRegistered = await client.isRegisteredUser(number);
//     return isRegistered;
//   }

//   let success = 0;
//   let fail = 0;
//   let numberNotRegister = 0;

//   data.forEach(async (item) => {
//     const number = phoneNumberFormatter(item.number)
//     const isRegisteredNumber = await checkRegisteredNumber(number);

//     if (!isRegisteredNumber) {
//       numberNotRegister++;
//     } else {
//       client.sendMessage(number, item.message).then(response => {
//         success++;
//         // res.status(200).json({
//         //   status: true,
//         //   response: response
//         // });
//       }).catch(err => {
//         fail++;
//         // res.status(500).json({
//         //   status: false,
//         //   response: err
//         // });
//       });
//     }
//   });

//   return res.status(200).json({
//     status: true,
//     response: {
//       success: success,
//       fail: fail,
//       numberNotRegister: numberNotRegister
//     }
//   });
// });

// Send media
app.post('/send-media', async (req, res) => {
  const token = req.header('x-token');

  if (token !== SECRET_TOKEN) {
    return res.status(401).json({
      status: false,
      message: 'Unauthenticated'
    })
  }

  const sender = req.body.sender;
  const number = phoneNumberFormatter(req.body.number);
  const caption = req.body.caption;
  const fileUrl = req.body.file;

  // const media = MessageMedia.fromFilePath('./image-example.png');
  // const file = req.files.file;
  // const media = new MessageMedia(file.mimetype, file.data.toString('base64'), file.name);
  let mimetype;
  const attachment = await axios.get(fileUrl, {
    responseType: 'arraybuffer'
  }).then(response => {
    mimetype = response.headers['content-type'];
    return response.data.toString('base64');
  });

  const media = new MessageMedia(mimetype, attachment, 'Media');
  const client = sessions.find(sess => sess.id == sender).client;

  const checkRegisteredNumber = async function (number) {
    const isRegistered = await client.isRegisteredUser(number);
    return isRegistered;
  }

  const isRegisteredNumber = await checkRegisteredNumber(number);

  if (!isRegisteredNumber) {
    return res.status(422).json({
      status: false,
      message: 'The number is not registered'
    });
  }



  client.sendMessage(number, media, {
    caption: caption
  }).then(response => {
    res.status(200).json({
      status: true,
      response: response
    });
  }).catch(err => {
    res.status(500).json({
      status: false,
      response: err
    });
  });
});

server.listen(port, function () {
  console.log('App running on *: ' + port);
});
