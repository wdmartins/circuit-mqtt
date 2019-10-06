'use strict';

const config = require('./config');
const bunyan = require('bunyan');
const Circuit = require('circuit-sdk');
const mqtt = require('mqtt');

// MQTT Topic to set the light state
const MQTT_TOPIC_SET = '/circuit/rgbw/set';
// MQTT Topic to received the actual light state and update the control form accordingly
const MQTT_TOPIC_STATE = '/circuit/rgbw';

let sdkLogger = bunyan.createLogger({
    name: 'sdk',
    stream: process.stdout,
    level: config.sdkLogLevel
});

let logger = bunyan.createLogger({
    name: 'mqtt',
    stream: process.stdout
});

// The Circuit user
let user;
// The Conversation where form will be posted and updated
let monitoringConv;
// The MQTT Client
let mqttClient;
// The Item Id of the current form
let currentItemId;
// Current light values
let currentIntensity;
let currentColor;
let currentEffect;

Circuit.setLogger(sdkLogger);

let Bot = function(client) {

    /*
     * sendControlForm
     */
    async function sendControlForm() {
        let item = {
            content: 'Control Form',
            form: {
                id: 'controlForm',
                controls: [{
                    type: Circuit.Enums.FormControlType.LABEL,
                    text: 'Intensity'
                    }, {
                    type: Circuit.Enums.FormControlType.DROPDOWN,
                    name: 'intensity',
                    defaultValue: currentIntensity || '0',
                    options: [{
                        text: 'Off',
                        value: '0'
                    }, {
                        text: '25%',
                        value: '25'
                    }, {
                        text: '50%',
                        value: '50'
                    }, {
                        text: '75%',
                        value: '75'
                    }, {
                        text: '100%',
                        value: '100'
                    }]
                }, {
                    type: Circuit.Enums.FormControlType.LABEL,
                    text: 'Color'
                }, {
                    type: Circuit.Enums.FormControlType.DROPDOWN,
                    name: 'color',
                    defaultValue: currentColor || 'red',
                    options: [{
                        text: 'RED',
                        value: 'red'
                    }, {
                        text: 'GREEN',
                        value: 'green'
                    }, {
                        text: 'BLUE',
                        value: 'blue'
                    }]
                }, {
                    type: Circuit.Enums.FormControlType.CHECKBOX,
                    name: 'christmas',
                    text: `It's Christmas!`,
                    defaultValue: (currentEffect === 'christmas' ? 'true' : 'false')
                }, {
                    type: Circuit.Enums.FormControlType.BUTTON,
                    options: [{
                        text: 'Submit',
                        notification: 'Submitted',
                        action: 'submit'
                    }]
                }]
            }
        };
        if (currentItemId) {
            // Form has been posted already. Just update the same post with the current values
            item.itemId = currentItemId;
            await client.updateTextItem(item);
            return;
        }
        // Form has not been posted yet. See if the conversation has been resolved already
        if (!monitoringConv) {
            logger.info(`[MQTT] Not ready to send form.`);
            return;
        }
        // Post form for the first time
        client.addTextItem(monitoringConv.convId, item).then((item => {currentItemId = item.itemId}));
    }

    /*
     * processFormSubmission
     */
    function processFormSubmission(evt) {
        logger.info(`[MQTT] process form submission. ${evt.form.id}`);
        logger.info(`[MQTT] Form Data: ${JSON.stringify(evt.form.data)}`);
        evt.form.data.forEach(ctrl => {
            logger.debug(`[MQTT] ${ctrl.key}: ${ctrl.value}`);
            switch (ctrl.name) {
                case 'intensity':
                    currentIntensity = ctrl.value;
                    break;
                case 'color':
                    currentColor = ctrl.value;
                    break;
                case 'christmas':
                    currentEffect = (ctrl.value === 'true' ? 'christmas' : 'colorful');
                    break;
                default:
                    logger.error(`Unknown key in submitted form: ${ctrl.key}`);
                    break;
            }
        });
        logger.info(`[MQTT] Intensity set to ${currentIntensity}, color set to ${currentColor} and effect is ${currentEffect}`);

        // Prepare MQTT payload
        let state = (currentIntensity === 0 ? 'OFF' : 'ON');
        let brightness = 255 * currentIntensity / 100;
        logger.info(`[MQTT] Sending state ${state}, color ${currentColor}, brightness ${brightness}, effect ${currentEffect}`);

        let payload = `{"state": "${state}","color":{"r": ${(currentColor == "red" ? 255 : 0)},"g": ${(currentColor == "green" ? 255 : 0)},"b": ${(currentColor == "blue" ? 255 : 0)}},"brightness": ${brightness},"white_value": 0, "effect":"colorful"}`;
        if (currentEffect !== 'colorful') {
            // Current color and is irrelevant for effects other than colorful and State is force to 'ON'.
            payload = `{"state": "ON", effect: "${currentEffect}","brightness": ${brightness}}`;
        }
        logger.info(`[MQTT] Payload = ${payload}`);

        // Send MQTT command
        mqttClient.publish(MQTT_TOPIC_SET, payload)
    }

    /*
     * getMonitoringConversation
     */
    async function getMonitoringConversation() {
        if (config.convId) {
            logger.info(`[MQTT] Check if conversation ${config.convId} exists`);
            try {
                let conv = await client.getConversationById(config.convId);
                if (conv) {
                    logger.info(`[MQTT] conversation ${config.convId} exists`);
                    return conv;
                }
            } catch (error) {
                logger.error(`[MQTT] Unable to get configured conversation. Error: ${error}`);
            }
        }
        logger.info('[MQTT] Conversation not configured or it does not exist. Find direct conv with owner');
        return client.getDirectConversationWithUser(config.botOwnerEmail, true);
    }

    /*
     * Connect to MQTT broker
     */
    this.connectToMqttBroker = function() {
        return new Promise((resolve, reject) => {
            if (!config.mqttBroker) {
                reject('MQTT Broker is not configured on config.json');
                return;
            }
            mqttClient = mqtt.connect([config.mqttBroker]);
            mqttClient.on('connect', resolve);
            mqttClient.on('error', reject);
            mqttClient.on('message', (topic, message) => {
                logger.info(`[MQTT] Received topic ${topic}`);
                logger.info(`[MQTT] Received message ${message.toString()}`);
                switch (topic) {
                    case MQTT_TOPIC_STATE:
                        // Parse MQTT message as JSON
                        message = JSON.parse(message);
                        if (message) {
                            if (message.color) {
                                currentColor = message.color.r > 0 ? 'red' : message.color.g > 0 ? 'green' : message.color.b > 0 ? 'blue' : currentColor;
                            }
                            if (message.brightness) {
                                currentIntensity = message.brightness < 255 * 0.25 ? '0' : message.brightness < 255 * 0.5 ? '25' : message.brightness < 255 * 0.75 ? '50' : message.brightness < 255 ? '75' : '100';
                            }
                            currentEffect = message.effect || currentEffect;
                        }
                        // Update control form according to received light values
                        sendControlForm();
                        break;
                    default:
                        logger.warn(`[MQTT] Unhandled Topic: ${topic}`);
                        break;
                }
            });
        });
    }

    /*
     * setupMqtt
     */
    this.setupMqtt = function() {
        return new Promise((resolve, reject) => {
            mqttClient.subscribe(MQTT_TOPIC_STATE, function(err, qos) {
                if (err) {
                    logger.error(`[MQTT] Error subscribing. Error ${err}`);
                    reject();
                    return;
                }
                logger.info(`[MQTT] Subscription successful. Qos: ${qos}`);
                resolve();
            });
        });
    }

    /*
     * terminate
     */
    this.terminate = function(err) {
        let error = new Error(err);
        logger.error(`[MQTT] bot failed ${error.message}`);
        logger.error(error.stack);
        process.exit(1);
    };

    /*
     * Logon Client
     */
    this.logonBot = function() {
        return new Promise((resolve) => {
            let retry;
            client.addEventListener('formSubmission', processFormSubmission);
            let logon = async function() {
                try {
                    user = await client.logon();
                    clearInterval(retry);
                    resolve();
                } catch (error) {
                    logger.error(`[MQTT] Error logging Bot. Error: ${error}`);
                }
            };
            logger.info(`[MQTT] Create bot instance with id: ${config.bot.client_id}`);
            retry = setInterval(logon, 2000);
        });
    };

    /*
     * start
     */
    this.start = async function() {
        logger.info('[MQTT] say hi');
        monitoringConv = await getMonitoringConversation();
        if (monitoringConv) {
            sendControlForm();
        }
    };


    /*
     * updateUserData
     */
    this.updateUserData = async function() {
        if (user && user.displayName !== `${config.bot.first_name} ${config.bot.last_name}`) {
            // Need to update user data
            try {
                user.firstName = config.bot.first_name;
                user.lastName = config.bot.last_name;
                user.displayName = `${config.bot.first_name} ${config.bot.last_name}`;
                await client.updateUser({
                    userId: user.userId,
                    firstName: config.bot.first_name,
                    lastName: config.bot.last_name,
                });
            } catch (error) {
                logger.error(`[MQTT] Unable to update user data. Error: ${error}`);
            }
        }
        return user;
    };
};

let bot = new Bot(new Circuit.Client(config.bot));
bot.logonBot()
    .then(bot.updateUserData)
    .then(bot.connectToMqttBroker)
    .then(bot.setupMqtt)
    .then(bot.start)
    .catch(bot.terminate);

