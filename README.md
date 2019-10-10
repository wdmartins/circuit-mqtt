# Circuit and MQTT

This project assumes the reader is familiar with Raspberry Pi, MQTT protocol, and Circuit SDK.

## Install Mosquitto Broker on Raspberry Pi

Mosquitto is now available through the main Raspberry repository, so to install mosquitto broker on your Raspberry Pi execute the following commands:

    sudo apt update
    sudo apt install -y mosquitto mosquitto-clients

It is recommended that the mosquitto broker auto starts on boot up. To achieve that execute the following command:

    sudo systemctl enable mosquitto.service

Verify mosquitto installation:

    mosquitto -v

Note: if you get an error saying "Address already in use" is probably because the broker is already running.

Also note the port number (usually 1883) you may need it to configured the application.

Test the mosquitto installation:
  1. Open two terminals
  2. On one terminal execute:
      
          mosquitto_sub -d -t testTopic
  3. On the second terminal publish a message using the test topic

          mosquitto_pub -d -t testTopic -m "Hello Circuit"

If you see 'Hello Circuit' on the first terminal then all is good and ready.


## Install and run the application

    git clone https://github.com/wdmartins/circuit-mqtt.git
    cd circuit-mqtt
    cp config.template.json config.json
    
Edit config.json and complete the required information

    npm install
    node index.js | ./node_modules/.bin/bunyan





