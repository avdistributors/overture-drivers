//------------------------------------------------------------------------------------------ CONSTANTS
const CMD_DEFER_TIME = 3000         // Timeout when using commandDefer
const POLL_PERIOD = 5000            // Polling function interval
const TICK_PERIOD = 5000            // In-built tick interval
const TCP_TIMEOUT = 30000           // Will timeout after this length of inactivity
const TCP_RECONNECT_DELAY = 5000    // How long to wait before attempting to reconnect

let host
exports.init = _host => {
    host = _host
}

exports.createDevice = base => {
    const logger = base.logger || host.logger
    let config
    let tcpClient

    let frameParser = host.createFrameParser()
    frameParser.setSeparator('\r')
    frameParser.on('data', data => onFrame(data))

    //------------------------------------------------------------------------- STANDARD SDK FUNCTIONS
    function setup(_config) {
        config = _config
        base.setTickPeriod(TICK_PERIOD)
        // Register polling functions
        const defaults = {period: POLL_PERIOD, enablePollFn: isConnected, startImmediately: true}
        base.setPoll({ action: 'keepAlive', period: POLL_PERIOD, enablePollFn: isConnected, startImmediately: true })
        // base.setPoll({...defaults, action: 'getPower'})
        // base.setPoll({...defaults, action: 'getSource', enablePollFn: isPoweredOn})

        // PRESETS
        let preset_enums = ['Idle']
        for (let preset of config.presets) {
            preset_enums.push(preset.name)
        }
        if (preset_enums.length > 1) {
            base.createVariable({
                name: 'Preset',
                type: 'enum',
                enums: preset_enums,
                perform: {
                    action: 'Recall Preset',
                    params: {
                        Name: '$string'
                    }
                }
            })
        }

        // GAIN MODULES
        for (let gain of config.gains) {
            const name = gain.name.replace(/[^A-Za-z0-9_]/g, '') // Create legal variable name

            base.createVariable({
                name: `AudioMute_${name}`,
                type: 'enum',
                enums: ['Off', 'On'],
                perform: {
                    action: 'Set Audio Mute',
                    params: {
                        Name: gain.name,
                        Status: '$string'
                    }
                }
            })

            base.createVariable({
                name: `AudioLevel_${name}`,
                type: 'integer',
                minimum: 0,
                maximum: 100,
                perform: {
                    action: 'Set Audio Level',
                    params: {
                        Name: gain.name,
                        Level: '$value'
                    }
                }
            })
        }
    }

    function start() {
        initTcpClient()
    }

    function tick() {
        if (!tcpClient) initTcpClient()
    }

    function disconnect() {
        base.getVar('Status').string = 'Disconnected'
        base.getVar('Power').string = 'Off'
    }

    function stop() {
        disconnect()
        tcpClient && tcpClient.end()
        tcpClient = null
        base.stopPolling()
        base.clearPendingCommands()
    }

    function initTcpClient() {
        if (tcpClient) return // Do nothing if tcpClient already exists

        tcpClient = host.createTCPClient()
        tcpClient.setOptions({
            receiveTimeout: TCP_TIMEOUT,
            autoReconnectionAttemptDelay: TCP_RECONNECT_DELAY
        })

        tcpClient.on('connect', () => {
            logger.silly('TCPClient connected')
            base.getVar('Status').string = 'Connected'
            base.startPolling()
        })

        tcpClient.on('data', data => {
            logger.warn(`Type of data: ${data.constructor.toString()}`)
            if (data.length === 1 && data[0] === 0x06) {
                let pending = base.getPendingCommand()
                pending && logger.debug(`TCP DATA, Pending action = ${pending.action}). Params = ${pending.params}`)
            }
            frameParser.push(data.toString())
        })

        tcpClient.on('close', () => {
            logger.silly('TCPClient closed')
            disconnect() // Triggered on timeout, this allows auto reconnect
        })

        tcpClient.on('error', err => {
            logger.error(`TCPClient: ${err}`)
            stop() // Throw out the tcpClient and get a fresh connection
        })

        tcpClient.connect(config.port, config.host)
    }

    //-------------------------------------------------------------------------- SEND/RECEIVE HANDLERS
    function send(data) {
        logger.silly(`TCPClient send: ${data}`)
        return tcpClient && tcpClient.write(data)
    }

    function sendDefer(data) {
        base.commandDefer(CMD_DEFER_TIME)
        if (!send(data)) base.commandError('Data not sent')
    }

    function onFrame(data) {
        let pending = base.getPendingCommand()
        logger.debug(`onFrame (pending = ${pending && pending.action}): ${data}`)
        let match = data.match(/POWR(\d+)/)
        let iptest = data.match('IP')
        let recalltest = data.match('06')
        logger.warn(`The Data is: ${data}`)
        if (match && pending) {
            if (match && pending.action == 'getPower') {
                base.getVar('Power').value = parseInt(match[1]) // 0 = Off, 1 = On
                base.commandDone()
            }
            else if (match && pending.action == 'setPower') {
                base.getVar('Power').string = pending.params.Status
                base.commandDone()
            }
        }
        else if (iptest){
            logger.warn(`Recieved ${data}`)
            base.commandDone()
        }
        else if (recalltest){
            logger.warn(`Recieved ${data}`)
            base.commandDone()
        }
        else if (match && !pending) {
            logger.warn(`Received data but no pending command: ${data}`)
        }
        else {
            logger.warn(`onFrame data not processed: ${data}`)
        }
    }

    //---------------------------------------------------------------------------------- GET FUNCTIONS
    function getPower() {
        sendDefer('IP\r')
    }


    function getSource() {
        sendDefer('*SEINPT################\n')
    }

    //---------------------------------------------------------------------------------- SET FUNCTIONS
    function setPower(params) {
        if (params.Status == 'Off') sendDefer('*SCPOWR0000000000000000\n')
        else if (params.Status == 'On') sendDefer('*SCPOWR0000000000000001\n')
    }

    function setAudioMute(params) {
        if (params.Status == 'Off') sendDefer('*SCPOWR0000000000000000\n')
        else if (params.Status == 'On') sendDefer('*SCPOWR0000000000000001\n')
    }

    function setAudioLevel(params) {
    }

    function recallPreset(params) {
        let result = config.presets.find(entry => entry.name === params.Name)
        // Equivalent to: entry => entry.name === params.Name
        // function(entry) {
        //     return (entry.name === params.Name)
        // }

        if (result) {
            sendDefer(`SS ${result.number}\r`)
        }
        else {
            logger.error(`Preset not found: ${params.Name}`)
        }
    }

    //------------------------------------------------------------------------------- HELPER FUNCTIONS
    function isConnected() {
        return base.getVar('Status').string == 'Connected'
    }

    function isPoweredOn() {
        return isConnected() && base.getVar('Power').string == 'On'
    }

    function keepAlive() {
        sendDefer('IP\r')
    }
    //----------------------------------------------------------------------------- EXPORTED FUNCTIONS
    return {
        setup, start, stop, tick,
        getPower, getSource,
        setPower, setAudioMute, setAudioLevel,
        keepAlive,
        recallPreset
    }
}
