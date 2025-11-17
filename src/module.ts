/**
 * This file contains the plugin template.
 *
 * @file module.ts
 * @author Luca Liguori
 * @created 2025-06-15
 * @version 1.3.0
 * @license Apache-2.0
 *
 * Copyright 2025, 2026, 2027 Luca Liguori.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  MatterbridgeDynamicPlatform,
  PlatformConfig,
  PlatformMatterbridge,
  MatterbridgeEndpoint,
  genericSwitch,
  DeviceTypeDefinition,
  // DeviceTypes used in HA → Matter mapping
  onOffOutlet,
  onOffSwitch,
  dimmableLight,
  temperatureSensor,
  humiditySensor,
  pressureSensor,
  lightSensor,
  electricalSensor,
  airQualitySensor,
  occupancySensor,
  contactSensor,
  waterLeakDetector,
  smokeCoAlarm,
  waterValve,
  coverDevice,
  fanDevice,
  airPurifier,
  thermostatDevice,
  doorLockDevice,
  modeSelect,
} from 'matterbridge';
import { AnsiLogger, LogLevel } from 'matterbridge/logger';

import { MqttClientClass } from './mqtt.js';

interface EntityPayload {
  discovertype: string;
  discoverTopic: string;
  unique_id: string; // ⬅️ optional, weil Automations keine haben müssen
  name: string;
  device: {
    name: string;
    identifiers: string[];
  };

  // 🔹 Allgemeine MQTT Discovery-Felder
  state_topic?: string;
  command_topic?: string;
  entity_category?: string;
  unit_of_measurement?: string;
  step?: number;
  min?: number;
  max?: number;
  state_class?: string;
  device_class?: string;
  payload_on?: string;
  payload_off?: string;
  state_on?: string;
  state_off?: string;

  // 🔹 Thermostat-spezifisch
  mode_state_topic?: string;
  mode_command_topic?: string;
  temperature_state_topic?: string;
  temperature_command_topic?: string;
  current_temperature_topic?: string;
  min_temp?: number;
  max_temp?: number;
  modes?: string[];
  precision?: number;
  temp_step?: number;

  // 🔹 Automation / Trigger-spezifisch (wie in deinem Beispiel)
  automation_type?: string;
  type?: string;
  subtype?: string;
  topic?: string;

  // 🔹 Catch-all für unbekannte Felder
  [key: string]: unknown;
}

interface DeviceInfo {
  name: string;
  Ids: Record<string, EntityPayload>;
}

/**
 * This is the standard interface for Matterbridge plugins.
 * Each plugin should export a default function that follows this signature.
 *
 * @param {PlatformMatterbridge} matterbridge - An instance of MatterBridge.
 * @param {AnsiLogger} log - An instance of AnsiLogger. This is used for logging messages in a format that can be displayed with ANSI color codes and in the frontend.
 * @param {PlatformConfig} config - The platform configuration.
 * @returns {TemplatePlatform} - An instance of the MatterbridgeAccessory or MatterbridgeDynamicPlatform class. This is the main interface for interacting with the Matterbridge system.
 */
export default function initializePlugin(matterbridge: PlatformMatterbridge, log: AnsiLogger, config: PlatformConfig): TemplatePlatform {
  return new TemplatePlatform(matterbridge, log, config);
}

// Here we define the TemplatePlatform class, which extends the MatterbridgeDynamicPlatform.
// If you want to create an Accessory platform plugin, you should extend the MatterbridgeAccessoryPlatform class instead.
export class TemplatePlatform extends MatterbridgeDynamicPlatform {
  // Declare Variables
  private client?: MqttClientClass;
  private discoveredDevices: Record<string, DeviceInfo> = {};
  private discoveredIds: Record<string, EntityPayload> = {};

  constructor(matterbridge: PlatformMatterbridge, log: AnsiLogger, config: PlatformConfig) {
    // Always call super(matterbridge, log, config)
    super(matterbridge, log, config);

    // Verify that Matterbridge is the correct version
    if (this.verifyMatterbridgeVersion === undefined || typeof this.verifyMatterbridgeVersion !== 'function' || !this.verifyMatterbridgeVersion('3.3.0')) {
      throw new Error(
        `This plugin requires Matterbridge version >= "3.3.0". Please update Matterbridge from ${this.matterbridge.matterbridgeVersion} to the latest version in the frontend."`,
      );
    }

    this.log.info(`Initializing Platform...`);
  }

  override async onStart(reason?: string) {
    this.log.info(`onStart called with reason: ${reason ?? 'none'}`);

    // Wait for the platform to fully load the select
    await this.ready;
    this.log.info('config: ' + JSON.stringify(this.config));
    // Clean the selectDevice and selectEntity maps, if you want to reset the select.
    await this.clearSelect();

    // instance Mqtt client
    const mqttSettings = {
      discoverTopic: String(this.config.discoverTopic),
      host: String(this.config.host),
      port: Number(this.config.port),
      username: String(this.config.username),
      password: String(this.config.password),
    };
    this.log.info('mqttSettings: ' + JSON.stringify(mqttSettings));
    this.client = new MqttClientClass(mqttSettings, this.log);

    this.client.on('connect', () => {
      this.log.info('connected XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');
    });

    this.client.on('discover', (topic, message) => {
      const activeFuntion = 'module.ts - discover';
      this.log.info(`Function started: ${activeFuntion}`);
      try {
        this.collectIdsForDevice(topic, message);
      } catch (e) {
        this.log.error(`error at: ${activeFuntion} - ${e}`);
      }
    });

    this.client.on('discoverEnds', () => {
      for (const device in this.discoveredDevices) {
        this.log.info('New Device:');
        this.log.info(JSON.stringify(this.discoveredDevices[device]));
        this.discoverDevice(device, this.discoveredDevices[device]);
      }
    });

    /* this.client.on('message', (topic, message) => {
      // this.discoverDevices();
    });*/
  }

  async collectIdsForDevice(discoverTopic: string, message: string) {
    const activeFuntion = 'module.ts - collectIdsForDevice';
    this.log.info(`Function started: ${activeFuntion}`);
    try {
      const payload = JSON.parse(message);
      // assign topic
      payload.discoverTopic = discoverTopic;
      // Get Type
      discoverTopic = discoverTopic.replace(`${String(this.config.discoverTopic)}/`, '');
      payload.discoverType = discoverTopic.substring(0, discoverTopic.indexOf('/'));
      this.log.error(payload.discoverType);
      const IduniqueId = payload.unique_id;
      const DeviceName = payload.device.name;
      const DeviceIdentifier = payload.device.identifiers[0];

      if (!this.discoveredIds[IduniqueId]) {
        this.discoveredIds[IduniqueId] = payload;
      }
      if (!this.discoveredDevices[DeviceIdentifier]) {
        this.discoveredDevices[DeviceIdentifier] = { name: DeviceName, Ids: {} };
      }
      if (!this.discoveredDevices[DeviceIdentifier].Ids[IduniqueId]) {
        this.discoveredDevices[DeviceIdentifier].Ids[IduniqueId] = payload;
      }
    } catch (e) {
      this.log.error(`error at: ${activeFuntion} - ${e}`);
    }
  }

  override async onConfigure() {
    // Always call super.onConfigure()
    await super.onConfigure();

    this.log.info('onConfigure called');

    // Configure all your devices. The persisted attributes need to be updated.
    for (const device of this.getDevices()) {
      this.log.info(`Configuring device: ${device.uniqueId}`);
      // You can update the device configuration here, for example:
      // device.updateConfiguration({ key: 'value' });
    }
  }

  override async onChangeLoggerLevel(logLevel: LogLevel) {
    this.log.info(`onChangeLoggerLevel called with: ${logLevel}`);
    // Change here the logger level of the api you use or of your devices
  }

  override async onShutdown(reason?: string) {
    // Always call super.onShutdown(reason)
    await super.onShutdown(reason);

    this.log.info(`onShutdown called with reason: ${reason ?? 'none'}`);
    if (this.config.unregisterOnShutdown === true) await this.unregisterAllDevices();
  }

  private async discoverDevice(deviceUniqueId: string, device: DeviceInfo) {
    const activeFuntion = 'module.ts - discoverDevice';
    this.log.info(`Function started: ${activeFuntion}`);
    try {
      /* const deviceToDiscover = new MatterbridgeEndpoint(onOffOutlet, { uniqueStorageKey: deviceUniqueId })
        .createDefaultBridgedDeviceBasicInformationClusterServer(
          device.name,
          'SN123456',
          this.matterbridge.aggregatorVendorId,
          'Matterbridge',
          'Matterbridge Outlet',
          10000,
          '1.0.0',
        )
        .createDefaultPowerSourceWiredClusterServer()
        .addRequiredClusterServers()
        .addCommandHandler('on', (data) => {
          this.log.info(`Command on called on cluster ${data.cluster}`);
        })
        .addCommandHandler('off', (data) => {
          this.log.info(`Command off called on cluster ${data.cluster}`);
        });

      await this.registerDevice(deviceToDiscover);*/
      // Bridge-Hauptgerät
      const bridgeDevice = new MatterbridgeEndpoint(genericSwitch, {
        id: deviceUniqueId,
      })
        .createDefaultBridgedDeviceBasicInformationClusterServer(
          device.name,
          'unknown',
          this.matterbridge.aggregatorVendorId,
          'Matterbridge',
          'LoRaWAN Base Device',
          10000,
          '1.0.0',
        )
        .createDefaultPowerSourceWiredClusterServer()
        .addRequiredClusterServers();

      /* for (const id of Object.values(device.Ids)) {
        bridgeDevice.addChildDeviceType(id.unique_id, onOffOutlet);
      }*/

      for (const id of Object.values(device.Ids)) {
        const deviceTypeDefinition = this.mapDiscoveryToMatterDeviceType(id);
        /* const child = new MatterbridgeEndpoint(onOffOutlet, {
          uniqueStorageKey: id.unique_id,
        })
          .createDefaultBridgedDeviceBasicInformationClusterServer(id.name, 'unknown', this.matterbridge.aggregatorVendorId, 'Matterbridge', 'LoRa Child Endpoint', 10001, '1.0.0')
          .addRequiredClusterServers(); */
        // Assign:
        bridgeDevice.addChildDeviceType(id.name, deviceTypeDefinition);
      }

      // Register device
      await this.registerDevice(bridgeDevice);
    } catch (e) {
      this.log.error(`error at: ${activeFuntion} - ${e}`);
    }
  }

  private mapDiscoveryToMatterDeviceType(entityPayload: EntityPayload): DeviceTypeDefinition {
    const map: Record<string, DeviceTypeDefinition> = {
      temperature: temperatureSensor,
      humidity: humiditySensor,
      pressure: pressureSensor,
      illuminance: lightSensor,
      power: electricalSensor,
      energy: electricalSensor,
      voltage: electricalSensor,
      current: electricalSensor,
      carbon_dioxide: airQualitySensor,
      carbon_monoxide: airQualitySensor,
      volatile_organic_compounds_parts: airQualitySensor,
      motion: occupancySensor,
      presence: occupancySensor,
      door: contactSensor,
      window: contactSensor,
      moisture: waterLeakDetector,
      smoke: smokeCoAlarm,
      gas: smokeCoAlarm,
      light: dimmableLight,
      switch: onOffSwitch,
      outlet: onOffOutlet,
      valve: waterValve,
      cover: coverDevice,
      fan: fanDevice,
      humidifier: airPurifier,
      dehumidifier: airPurifier,
      thermostat: thermostatDevice,
      lock: doorLockDevice,
    };

    if (entityPayload.device_class && map[entityPayload.device_class]) {
      return map[entityPayload.device_class];
    }

    // Unit based Fallback
    const unit = entityPayload.unit_of_measurement;
    if (unit) {
      if (['W', 'Wh', 'kWh'].includes(unit)) return electricalSensor;
      if (['°C', '°F'].includes(unit)) return temperatureSensor;
    }

    // Erweiterte Rückfalllogik
    if (entityPayload.discoveryType === 'number') {
      if (entityPayload.min != null && entityPayload.min >= 0 && entityPayload.max != null && entityPayload.max <= 100) {
        return dimmableLight;
      }
      return modeSelect;
    }

    if (entityPayload.discoveryType === 'select') {
      return modeSelect;
    }
    // General Fallback
    return genericSwitch;
  }
}
