'use strict'

const POLL_PERIOD = 30000 // Continuous polling interval used for checkStatus
const TCP_TIMEOUT = 2000 // Will timeout after this length of inactivity

let host
exports.init = _host => {
  host = _host
}

exports.createDevice = base => {
  const logger = base.logger || host.logger
  let config
  const ir_codes = require('./ir_codes.json')

  // ------------------------------ BASE FUNCTIONS ------------------------------
  function setup(_config) {
    config = _config
    // Register polling functions
    base.setPoll({
      action: 'checkStatus',
      period: POLL_PERIOD,
      startImmediately: false
    })
    base.getVar('IR_Commands').enums = ['Idle'].concat(Object.keys(ir_codes))
  }

  function start() {
    base.startPolling()
  }

  function stop() {
    base.clearPendingCommands()
    base.stopPolling()
    base.getVar('Status').string = 'Disconnected'
  }

  function initTcpClient() {
    if (tcpClient) return // Return if tcpClient already exists

    tcpClient = host.createTCPClient()
    tcpClient.setOptions({
      receiveTimeout: TCP_TIMEOUT,
      autoReconnectionAttemptDelay: TCP_RECONNECT_DELAY
    })
    tcpClient.connect(config.port, config.host)

    tcpClient.on('connect', () => {
      logger.silly('TCPClient connected')
      base.getVar('Status').string = 'Connected'
      base.startPolling()
    })

    tcpClient.on('data', data => {
      onFrame(data.toString())
    })

    tcpClient.on('close', () => {
      logger.silly('TCPClient closed')
      base.getVar('Status').string = 'Disconnected' // Triggered on timeout, this allows auto reconnect
    })

    tcpClient.on('error', err => {
      logger.error(`TCPClient: ${err}`)
      stop() // Throw out the tcpClient and get a fresh connection
    })
  }

  // ------------------------------ SEND/RECEIVE HANDLERS ------------------------------

  function send(data) {
    base.commandDefer(CMD_DEFER_TIME)
    // base.commandError('Data not sent')
    let success = false
    let attempts = 0
    while (attempts < 3 && !success) {
      connectThenSend(data)
        .then(res => {
          //
          success = true
        })
        .catch(error => {
          //
        })
    }
  }

  function connectThenSend(data) {
    // Open a TCP connection, send data, and wait for response.
    // If connection fails, retry 3 times before admitting defeat.
    
    return new Promise((resolve, reject) => {
      let tcpClient = host.createTCPClient()
      tcpClient.setOptions({
        receiveTimeout: TCP_TIMEOUT
      })

      let frameParser = host.createFrameParser()
      frameParser.setSeparator('\r')
      // If we receive a complete frame, resolve the promise
      frameParser.on('data', data => {
        tcpClient.end()
        resolve(data)
      })
      
      tcpClient.on('connect', () => {
        base.getVar('Status').string = 'Connected'
        let res = tcpClient.write(data)
        logger.silly(`tcpClient connected. Writing... ${res}`)
      })
      
      tcpClient.on('data', data => {
        frameParser.push(data.toString())
      })
      
      tcpClient.on('close', () => {
        logger.silly('tcpClient closed')
      })
      
      tcpClient.on('error', err => {
        logger.error(`tcpClient error: ${err}`)
        base.getVar('Status').string = 'Disconnected'
        reject(err)
      })
      
      tcpClient.connect(config.port, config.host)
    })
  }

  function onFrame(data) {
    const pendingCommand = base.getPendingCommand()
    if (pendingCommand && pendingCommand.action === 'sendCommand') {
      const cmdName = base.getVar('IR_Commands').enums[
        pendingCommand.params.Index
      ]
      logger.silly(`pendingCommand: ${cmdName}  -  received: ${data}`)
      base.getVar('IR_Commands').value = 0 // Set back to idle
      base.commandDone()
    }
    if (pendingCommand && pendingCommand.action === 'keepAlive') {
      base.commandDone()
    }
  }

  // ------------------------------ DEVICE FUNCTIONS ------------------------------

  function sendCommand(params) {
    let name = base.getVar('IR_Commands').enums[params.Index]
    let code = ir_codes[name]
    if (code) {
      base.getVar('IR_Commands').value = params.Index
      // sendDefer(`sendir,${config.module}:${config.ir_port},${code}\r`)
      setTimeout(function() {
        let v = base.getVar('IR_Commands')
        if (v.value !== 0) v.value = 0 // Set back to idle
      }, 1)
    }
    else {
      logger.error(
        `Invalid command index sent to function sendCommand: ${params.Index}`
      )
    }
  }

  function checkStatus() {
    // sendDefer('getversion\r')
  }

  // ------------------------------ EXPORTED FUNCTIONS ------------------------------
  return {
    setup, start, stop, tick,
    sendCommand, checkStatus
  }
}
