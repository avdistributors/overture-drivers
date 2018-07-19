const CMD_DEFER_TIME = 10000;
const FORCE_RECONNECT = 30000;  // Forced reconnect delay after server-side disconnect


var host
exports.init = _host => {
  host = _host
}


exports.createDevice = base => {
  const logger = base.logger || host.logger;
  var config;
  var io = require('socket.io-client');
  var socket;
  var remote_vars = {};


  // BASE FUNCTIONS -----------------------------------------------------------

  const setup = _config => {
    config = _config

    // Create remote variable references, with attached perform function
    config.remote.forEach(thisvar => {
      base.createVariable({
        name: `${thisvar.server}__${thisvar.point.replace(/\./g, '__')}`,
        type: thisvar.type,
        // perform: {
        //   action: 'pushRemote',
        //   params: { Info: thisvar, Data: '$value' }
        // }
      });
    });
  }


  const start = () => {
    // Create local variable listeners
    config.local.forEach(thisvar => {
      base.addVariableListener(thisvar.point, 'actualchange', updateLocal);
    });

    logger.silly(`Socket client started, attempting connection to http://${config.host}:${config.port}`);
    initSocket();
  }


  const stop = () => {
    base.getVar('Status').string = 'Disconnected';
  }


  // DEVICE FUNCTIONS ---------------------------------------------------------

  const initSocket = () => {
    if (!socket) {
      socket = io(`http://${config.host}:${config.port}`);

      socket.on('connect', () => {
        socket.emit('authentication', {key: config.key});  // Send authentication to server
        logger.silly(`Connected with socket id: ${socket.id}`);
        base.getVar('Status').string = 'Connected';
      });

      socket.on('disconnect', (reason) => {
        logger.silly(`Disconnected from socket server: ${reason}`);
        base.getVar('Status').string = 'Disconnected';
        if(reason === 'io server disconnect') {
          logger.error(`Socket server forced a disconnect, check authentication key and reload driver`);
          setTimeout(() => socket.connect(), FORCE_RECONNECT);  // Attempt reconnection after server-side disconnect
        }
      });

      socket.on('update', data => {
        // Update event from remote client
        updateRemote(data);
      });
    }
  }


  const updateLocal = variable => {
    // let thisvar = config.local.filter(x => x.point === variable.fullName); Not keeping local references anymore
    let val = variable.type === 'enum' ? variable.enums[variable.value] : variable.value;
    logger.silly(`Broadcasting update ... ${variable.fullName} = ${val}`);

    if (socket.connected) {
      let data = {};
      data.server = config.reference;
      data.point = variable.fullName;
      data.type = variable.type;
      data.value = variable.value;
      variable.type === 'enum' && (data.enums = variable.enums);
      variable.type === 'integer' && (data.min = variable.min);
      variable.type === 'integer' && (data.max = variable.max);
      socket.emit('update', data);
    }
    else {
      logger.error('Socket disconnected, update not sent.');
    }
  }


  const updateRemote = data => {
    /*
    INTEGER
    {
      server: 'tobyCS',
      point: 'toby_test.Volume',
      type: 'integer',
      value: 8,
      min: 0,
      max: 100
    }

    ENUM
    {
      server: 'tobyCS',
      point: 'toby_test.Source',
      type: 'enum',
      value: 2,
      enums: [ 'Input1', 'Input2', 'Input3', 'Input4' ]
    }

    STRING
    {
      server: 'tobyCS',
      point: 'toby_test.Message',
      type: 'string',
      value: 'testing'
    }
    */

    // Check if this driver is subscribed to the received variable
    let varname = `${data.server}__${data.point.replace(/\./g, '__')}`;
    let thisvar = base.getVar(varname);
    if (thisvar) {
      // CHECK DATAA TYPE
      if (thisvar.type === data.type) {
        logger.debug(`Update received: ${varname}`);
        logger.silly(JSON.stringify(data));
        // if enum, make sure enums match
        if (data.type === 'enum' && thisvar.enums != data.enums) thisvar.enums = data.enums;
        // if integer, make sure min/max match
        if (data.type === 'integer' && thisvar.min != data.min) thisvar.min = data.min;
        if (data.type === 'integer' && thisvar.max != data.max) thisvar.max = data.max;
        // Finally, update the value
        thisvar.value = data.value;
      }
      else {
        logger.error(`Could not update variable from remote: data type mismatch (check config settings)`);
      }
    }

  }


  const pushRemote = params => {
    // Push a value to the remote server
    if (socket && socket.connected) {
      // socket.emit('update', {info: params.Info, data: params.Data});
      // params.Info includes:
      //  .server
      //  .point
      //  .name
      //  .type
    }
    else {
      logger.error('Could not push variable to remote server, socket not connected');
    }
  }


  // MAKE SURE THESE MATCH ABOVE ----------------------------------------------
  return {
    setup, start, stop,
    updateLocal, updateRemote, pushRemote
  }
}