// bluetooth-printer.js
// Maneja la conexión Web Bluetooth con impresoras térmicas POS genéricas y la codificación ESC/POS

// UUIDs de servicios más comunes en impresoras POS térmicas Bluetooth (chinas y genéricas)
const PRINTER_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  "00001101-0000-1000-8000-00805f9b34fb"
];

const PRINTER_CHARACTERISTICS = [
  "00002af1-0000-1000-8000-00805f9b34fb",
  "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f",
  "49535343-8841-43f4-a8d4-ecbe34729bb3"
];

class BluetoothPrinter {
  constructor() {
    this.device = null;
    this.server = null;
    this.characteristic = null;
  }

  async connect() {
    if (!navigator.bluetooth) {
      throw new Error("Web Bluetooth no está soportado en este navegador. Intenta usar Chrome.");
    }

    try {
      this.device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: PRINTER_SERVICES
      });

      this.device.addEventListener('gattserverdisconnected', this.onDisconnected.bind(this));

      this.server = await this.device.gatt.connect();

      // Encontrar el servicio correcto
      let service = null;
      for (const uuid of PRINTER_SERVICES) {
        try {
          service = await this.server.getPrimaryService(uuid);
          if (service) break;
        } catch (e) {
          // Ignorar si no tiene el servicio
        }
      }

      if (!service) {
        throw new Error("No se encontró un servicio de impresión compatible en este dispositivo.");
      }

      // Encontrar la característica correcta
      let characteristics = await service.getCharacteristics();
      for (const char of characteristics) {
        if (char.properties.write || char.properties.writeWithoutResponse) {
          this.characteristic = char;
          break;
        }
      }

      if (!this.characteristic) {
        throw new Error("No se encontró una característica de escritura compatible.");
      }

      return true;
    } catch (error) {
      this.disconnect();
      throw error;
    }
  }

  onDisconnected() {
    console.log('Impresora desconectada.');
    this.characteristic = null;
    this.server = null;
    this.device = null;
    
    // Disparar evento para actualizar UI
    window.dispatchEvent(new CustomEvent('printer-disconnected'));
  }

  disconnect() {
    if (this.device && this.device.gatt.connected) {
      this.device.gatt.disconnect();
    }
  }

  isConnected() {
    return this.characteristic !== null;
  }

  // Envía los datos en chunks para evitar límites de MTU de BLE (generalmente 20 o 512 bytes)
  async sendData(buffer) {
    if (!this.isConnected()) {
      throw new Error("La impresora no está conectada");
    }

    const CHUNK_SIZE = 100; // Ajuste seguro para BLE
    for (let i = 0; i < buffer.length; i += CHUNK_SIZE) {
      const chunk = buffer.slice(i, i + CHUNK_SIZE);
      await this.characteristic.writeValue(chunk);
      // Pequeño retardo para evitar desbordar el buffer de la impresora
      await new Promise(r => setTimeout(r, 20)); 
    }
  }

  // Utilidad básica para convertir string a bytes ignorando tildes para impresoras que no soportan UTF-8 por defecto
  textToBytes(text) {
    // Normalizar a ASCII básico para evitar caracteres basura en POS chino
    const asciiText = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const encoder = new TextEncoder();
    return encoder.encode(asciiText);
  }
}

export class ReceiptBuilder {
  constructor() {
    this.buffer = [];
  }

  init() {
    this.buffer.push(0x1b, 0x40); // ESC @
    return this;
  }

  alignCenter() {
    this.buffer.push(0x1b, 0x61, 1); // ESC a 1
    return this;
  }

  alignLeft() {
    this.buffer.push(0x1b, 0x61, 0); // ESC a 0
    return this;
  }

  bold(on) {
    this.buffer.push(0x1b, 0x45, on ? 1 : 0); // ESC E n
    return this;
  }

  size(double) {
    this.buffer.push(0x1d, 0x21, double ? 0x11 : 0x00); // GS ! n
    return this;
  }

  text(str) {
    // Reemplaza los saltos de línea de HTML a texto si los hubiera
    str = str.replace(/<br\s*[\/]?>/gi, "\n");
    // Quita etiquetas HTML restantes
    str = str.replace(/<[^>]+>/g, "");
    
    // Mapeo básico para caracteres especiales en español a CP437/CP850
    const charMap = {
      'á': 160, 'é': 130, 'í': 161, 'ó': 162, 'ú': 163,
      'ñ': 164, 'Ñ': 165, 'ü': 129, 'Ü': 154, '¿': 168, '¡': 173
    };

    // Ajustar texto para no cortar palabras (32 caracteres máximo por línea)
    const MAX_LEN = 32;
    const lines = str.split('\n');
    let wrappedLines = [];

    for (const line of lines) {
      if (line.length <= MAX_LEN) {
        wrappedLines.push(line);
      } else {
        const words = line.split(' ');
        let currentLine = '';
        for (const word of words) {
          if (currentLine.length + word.length + (currentLine ? 1 : 0) <= MAX_LEN) {
            currentLine += (currentLine ? ' ' : '') + word;
          } else {
            if (currentLine) wrappedLines.push(currentLine);
            currentLine = word;
            // Si una sola palabra es más larga que MAX_LEN, tocará cortarla
            while (currentLine.length > MAX_LEN) {
              wrappedLines.push(currentLine.substring(0, MAX_LEN));
              currentLine = currentLine.substring(MAX_LEN);
            }
          }
        }
        if (currentLine) wrappedLines.push(currentLine);
      }
    }

    const wrappedStr = wrappedLines.join('\n');
    
    for (let i = 0; i < wrappedStr.length; i++) {
      const char = wrappedStr[i];
      if (charMap[char]) {
        this.buffer.push(charMap[char]);
      } else {
        const code = char.charCodeAt(0);
        if (code < 128) {
          this.buffer.push(code);
        } else {
          // Fallback a quitar tilde para otros caracteres no mapeados
          const normalized = char.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          this.buffer.push(normalized.charCodeAt(0) || 63); // 63 es '?'
        }
      }
    }
    return this;
  }

  newline() {
    this.buffer.push(0x0a); // LF
    return this;
  }
  
  feed(lines = 3) {
    this.buffer.push(0x1b, 0x64, lines); // ESC d n
    return this;
  }

  cut() {
    // GS V 66 0 (Feed and half cut)
    this.buffer.push(0x1d, 0x56, 0x42, 0x00);
    return this;
  }
  
  separator() {
    // 32 caracteres para papel de 58mm
    this.text("--------------------------------");
    this.newline();
    return this;
  }

  build() {
    return new Uint8Array(this.buffer);
  }
}

export const printerService = new BluetoothPrinter();
