import { EventEmitter } from 'node:events';

import mqtt, { MqttClient, IClientOptions, IClientPublishOptions } from 'mqtt';
import { AnsiLogger } from 'node-ansi-logger';

/**
 * Interface für Verbindungseinstellungen
 */
interface MqttSettings {
  discoverTopic: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
}

/**
 * MQTT Client Wrapper mit EventEmitter für externe Hooks
 */
export class MqttClientClass extends EventEmitter {
  private client: MqttClient;
  private internalConnectionState = false;
  private log: AnsiLogger;
  private discovertopic: string;
  private discoverActive: boolean;

  constructor(settings: MqttSettings, log: AnsiLogger) {
    super();
    this.discovertopic = settings.discoverTopic;
    this.discoverActive = true;
    this.log = log;
    this.log.info('settings: ' + JSON.stringify(settings));
    const options: IClientOptions = {
      port: settings.port,
      username: settings.username,
      password: settings.password,
      clientId: `matterbridge-lorawan-plugin`,
    };

    const host = settings.host?.startsWith('mqtt://') || settings.host?.startsWith('mqtts://') ? settings.host : `mqtt://${settings.host}`;
    this.client = mqtt.connect(host, options);

    this.registerEventHandlers();
  }

  private registerEventHandlers(): void {
    this.client.on('connect', async () => {
      if (!this.internalConnectionState) {
        this.emit('connect');
      }

      this.internalConnectionState = true;

      const subs = this.getSubscriptionArray();
      if (subs) {
        subs.push(`${this.discovertopic}/+/+/config`);
        subs.push(`${this.discovertopic}/+/+/+/config`);
        this.client.subscribe(subs);
      }

      // Reset discover after 5s
      setTimeout(() => {
        this.discoverActive = false;
        this.emit('discoverEnds');
      }, 500);
    });

    this.client.on('disconnect', () => {
      this.emit('disconnected');
    });

    this.client.on('close', () => {
      this.emit('Connection is closed.');
    });

    this.client.on('error', (err) => {
      this.emit('error', err);
    });

    this.client.on('message', async (topic: string, message: Buffer) => {
      try {
        if (this.discoverActive) {
          if (topic.startsWith(this.discovertopic) && topic.endsWith('/config')) {
            this.emit('discover', topic, message);
          }
        } else {
          this.emit('message', topic, message);
        }
      } catch (err) {
        this.emit('errorMessage', err);
      }
    });
  }

  /**
   * Veröffentliche eine Nachricht
   *
   * @param {string} topic - Topic, for publish.
   * @param {string | Buffer} message - message to publish.
   * @param {IClientPublishOptions} [opt] - options.
   * @returns {Promise<void>} Promise, wich is resolved in case of publish is finished.
   */
  async publish(topic: string, message: string | Buffer, opt?: IClientPublishOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.publish(topic, message, opt ?? {}, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Verbindung schließen
   */
  destroy(): void {
    this.client.end();
  }

  /**
   * Subscriptions Array
   *
   * @returns {string[]} Array of MQTT-Subscription-Topics
   */
  private getSubscriptionArray(): string[] | undefined {
    // Subscribe to the ending of state (with different counts of sublevels 2 - 10)
    const subscriptions = [];
    for (let i = 0; i <= 10; i++) {
      subscriptions.push(`lorawan_${i}/+/state`);
      subscriptions.push(`lorawan_${i}/+/+/state`);
    }
    return subscriptions;
  }
}
