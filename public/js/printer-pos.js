/**
 * PrinterPOS - Web Bluetooth ESC/POS Controller for APICCA Resetario
 * Focused on 58mm and 80mm thermal printers.
 */
class PrinterPOS {
  constructor() {
    this.device = null;
    this.server = null;
    this.characteristic = null;
    this.paperSize = 58; // Default 58mm
    this.isConnected = false;

    // Common UUIDs for Bluetooth Thermal Printers (Serial Port / GATT)
    this.SERVICE_UUIDS = [
      '000018f0-0000-1000-8000-00805f9b34fb', // Generic Generic Service
      '0000ff00-0000-1000-8000-00805f9b34fb', // Common in JP printers
      '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISCC (Standard for generic)
      '0000fee7-0000-1000-8000-00805f9b34fb', // WeChat/Generic
      'e7fe1802-5e3a-11e7-907b-a6006ad3dba0', // Some newer BLE printers
      'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // High-prevalence BLE POS Printer
      '0000ff02-0000-1000-8000-00805f9b34fb'  // Another common generic thermal printer UUID
    ];
  }

  setPaperSize(size) {
    this.paperSize = parseInt(size);
    console.log(`Paper size set to ${this.paperSize}mm`);
  }

  getColumns() {
    return this.paperSize === 80 ? 42 : 32;
  }

  async connect() {
    try {
      console.log('Requesting Bluetooth Device...');
      // We try to filter by known services, but we also allow "all devices" 
      // because many Chinese printers use unknown services.
      this.device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: this.SERVICE_UUIDS
      });

      console.log('Connecting to GATT Server...');
      this.server = await this.device.gatt.connect();

      // Find the primary service and characteristic
      // Since we don't know the exact UUID, we'll try to discover them.
      const services = await this.server.getPrimaryServices();
      
      for (const service of services) {
        const characteristics = await service.getCharacteristics();
        // Look for a characteristic that supports 'write' or 'writeWithoutResponse'
        const writeChar = characteristics.find(c => c.properties.write || c.properties.writeWithoutResponse);
        if (writeChar) {
          this.characteristic = writeChar;
          break;
        }
      }

      if (!this.characteristic) {
        throw new Error('No compatible characteristic found on the device.');
      }

      // Add a listener to keep track of unexpected disconnections
      this.device.addEventListener('gattserverdisconnected', () => {
        this.isConnected = false;
        console.log('Device disconnected (GATT Server)');
        // Try to update UI if on the main window
        const statusEl = document.getElementById("printer-status");
        if (statusEl) {
          statusEl.textContent = "Desconectada";
          statusEl.className = "printer-status status-disconnected";
        }
        const btn = document.getElementById("printer-connect-btn");
        if (btn) btn.textContent = "Conectar Impresora";
      });

      this.isConnected = true;
      console.log('Connected to printer!');
      
      // Initialize printer
      await this.send([0x1B, 0x40]);

      // Set international character set to USA (ESC R 0) — default.
      // DO NOT use Spain (ESC R 10) because it remaps ASCII:
      //   [ (0x5B) → ¡,  ] (0x5D) → ¿,  \ (0x5C) → Ñ,  etc.
      // We use WPC1252 code page instead for á é í ó ú ñ Ñ.
      await this.send([0x1B, 0x52, 0x00]);

      // Select Code Page WPC1252 (Windows Latin-1) — ESC t 16
      // WPC1252 includes á é í ó ú ñ Ñ ü at their standard Latin-1 byte positions
      // without remapping ASCII characters like [ ] \ @ # etc.
      await this.send([0x1B, 0x74, 0x10]);

      console.log('Printer initialized with WPC1252 + USA charset');

      return true;
    } catch (error) {
      console.error('Connection failed:', error);
      this.isConnected = false;
      throw error;
    }
  }

  async disconnect() {
    if (this.device && this.device.gatt.connected) {
      this.device.gatt.disconnect();
    }
    this.isConnected = false;
    console.log('Disconnected');
  }

  /**
   * Send raw bytes to the printer
   * Handles chunking to avoid MTU issues in BLE
   */
  async send(data) {
    if (!this.isConnected || !this.characteristic) return;

    const uint8Data = data instanceof Uint8Array ? data : new Uint8Array(data);
    const CHUNK_SIZE = 20; // Safe MTU size for generic BLE devices

    for (let i = 0; i < uint8Data.length; i += CHUNK_SIZE) {
      const chunk = uint8Data.slice(i, i + CHUNK_SIZE);
      if (this.characteristic.properties.writeWithoutResponse) {
        await this.characteristic.writeValueWithoutResponse(chunk);
      } else {
        await this.characteristic.writeValueWithResponse(chunk);
      }
    }
  }

  /**
   * Cleans text for thermal printers:
   * 1. Strips HTML tags
   * 2. Decodes HTML entities (so [], &, etc. print correctly)
   * 3. Keeps accented characters and ñ (encoded via Latin-1 in encodeText)
   */
  sanitizeText(text) {
    if (!text) return "";

    // 1. Strip HTML tags
    // Replace <p> with triple newlines to get two blank lines in the final output
    let clean = text
      .replace(/<p>/gi, "\n\n\n")
      .replace(/<br\/?>|<\/p>/gi, "\n")
      .replace(/<[^>]*>/g, "");

    // 2. Decode HTML entities
    clean = clean
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));

    // 3. Quitar saltos excesivos después de los encabezados específicos de Gemini
    clean = clean.replace(/(Preparar presentes alternativos\.?)\n\n+/gi, "$1\n");
    clean = clean.replace(/(Servir la mesa com[uú]n\.?)\n\n+/gi, "$1\n");

    return clean;
  }

  /**
   * Encode text to WPC1252 / Latin-1 bytes.
   *
   * For WPC1252 (Code Page 1252), the byte values of Spanish characters
   * are identical to their Unicode code points:
   *   á = U+00E1 → byte 0xE1
   *   é = U+00E9 → byte 0xE9
   *   í = U+00ED → byte 0xED
   *   ó = U+00F3 → byte 0xF3
   *   ú = U+00FA → byte 0xFA
   *   ñ = U+00F1 → byte 0xF1
   *   Ñ = U+00D1 → byte 0xD1
   *   ü = U+00FC → byte 0xFC
   *   Á = U+00C1 → byte 0xC1  etc.
   *
   * So we just use charCodeAt(0) directly for chars ≤ 0xFF.
   * This is much simpler and more reliable than mapping to CP437.
   *
   * NOTE: TextEncoder produces UTF-8 which uses MULTI-BYTE sequences
   * for these characters (e.g. á = 0xC3 0xA1), which thermal printers
   * cannot decode — that's why TextEncoder doesn't work here.
   */
  encodeText(text) {
    // NOTE: No llamamos sanitizeText aquí — ya se sanitizó en printReset.
    // Solo convertimos el texto a bytes Latin-1 (WPC1252).
    const input = text + '\n';

    const bytes = [];
    for (let i = 0; i < input.length; i++) {
      const code = input.charCodeAt(i);

      if (code <= 0xFF) {
        // ASCII + Latin-1 supplement — send byte directly
        // This covers all Spanish characters (á é í ó ú ñ Ñ ü Á É Í Ó Ú ¿ ¡)
        // And all ASCII specials: [ ] ( ) { } / \ | @ # $ % ^ & * etc.
        bytes.push(code);
      } else {
        // Character outside Latin-1 range — replace with '?'
        bytes.push(0x3F);
      }
    }
    return new Uint8Array(bytes);
  }

  // ESC/POS Command Helpers
  async printLine(text = '') {
    await this.send(this.encodeText(text));
  }

  /**
   * Print a line with emphasis applied inline.
   * Uses THREE different ESC/POS emphasis commands to maximize compatibility:
   *   1. ESC E 1  — Standard emphasis (some printers ignore this)
   *   2. ESC ! 8  — Print mode with bold bit set (bit 3 = emphasis)
   *   3. GS ! 1   — Double-height as visual fallback if neither bold works
   *
   * All commands + text + reset are sent as a SINGLE byte buffer
   * so the printer processes them atomically.
   */
  async printLineBold(text = '') {
    const emphasisOn = [
      0x1B, 0x45, 0x01,  // ESC E 1 — emphasis on
      0x1B, 0x21, 0x08,  // ESC ! 8 — select print mode: bold (bit 3)
    ];
    const emphasisOff = [
      0x1B, 0x21, 0x00,  // ESC ! 0 — select print mode: normal
      0x1B, 0x45, 0x00,  // ESC E 0 — emphasis off
    ];
    const textBytes = this.encodeText(text);
    // Combine: emphasis-on + text + \n + emphasis-off
    const combined = new Uint8Array(emphasisOn.length + textBytes.length + emphasisOff.length);
    combined.set(new Uint8Array(emphasisOn), 0);
    combined.set(textBytes, emphasisOn.length);
    combined.set(new Uint8Array(emphasisOff), emphasisOn.length + textBytes.length);
    await this.send(combined);
  }

  async setAlignCenter() { await this.send([0x1B, 0x61, 0x01]); }
  async setAlignLeft() { await this.send([0x1B, 0x61, 0x00]); }
  async setAlignRight() { await this.send([0x1B, 0x61, 0x02]); }
  async setBold(on) { await this.send([0x1B, 0x45, on ? 0x01 : 0x00]); }
  async setFontSize(size) { 
    // size 0 = normal, 1 = double height, 2 = double width, 3 = both
    const n = (size === 1) ? 0x01 : (size === 2) ? 0x10 : (size === 3) ? 0x11 : 0x00;
    await this.send([0x1D, 0x21, n]);
  }
  async feed(n = 3) { await this.send([0x1B, 0x64, n]); }
  async cut() { await this.send([0x1D, 0x56, 0x41, 0x03]); }

  /**
   * Print the structured Resetario data
   */
  async printReset(data) {
    if (!this.isConnected) return;

    const cols = this.getColumns();
    const divider = '-'.repeat(cols);

    // Header
    await this.setAlignCenter();
    await this.setFontSize(3);
    await this.printLine("APICCA");
    await this.setFontSize(0);
    await this.printLineBold("RE(S)ETARIO v.0.2");
    await this.printLine(new Date().toLocaleString());
    await this.printLine(divider);

    // Tactics
    if (data.tactics && data.tactics.length > 0) {
      await this.setAlignLeft();
      await this.printLineBold("TÁCTICAS:");
      for (const t of data.tactics) {
        await this.printLine(`(${t.eje}) ${t.title}`);
      }
      await this.printLine(divider);
    }

    // The Reset (AI Text)
    await this.setAlignLeft();
    await this.printLineBold("EL RE(S)ET:");
    await this.printLine(""); // Espacio limpio antes del contenido

    // Sanitize once — encodeText no vuelve a sanitizar
    const cleanText = this.sanitizeText(data.text);
    
    // Procesamos línea por línea para detectar encabezados específicos (Títulos 1 y 2)
    const rawLines = cleanText.split('\n');
    
    // Patrones flexibles para detectar los títulos (case-insensitive)
    // Gemini puede devolver: "1. Preparar presentes alternativos.",
    // "Preparar Presentes Alternativos", etc.
    const HEADER_PATTERNS = [
      /preparar\s+presentes\s+alternativos/i,
      /servir\s+la\s+mesa\s+com[uú]n/i
    ];

    for (const rawLine of rawLines) {
      if (!rawLine.trim()) {
        await this.printLine(""); 
        continue;
      }

      // Detectamos si es uno de los títulos que queremos con énfasis
      const isHeader = HEADER_PATTERNS.some(pattern => pattern.test(rawLine));

      if (isHeader) {
        // Limpiar el título: quitar numeración ("1. "), punto final,
        // y dejarlo en minúsculas con primera letra mayúscula
        let cleanTitle = rawLine
          .replace(/\.\s*$/, '')       // Quitar punto final
          .trim();
        // Minúsculas, solo primera letra del título en mayúscula (después del número)
        cleanTitle = cleanTitle.toLowerCase().replace(/(\d+\.\s*)(\w)/, (_, num, ch) => num + ch.toUpperCase());

        const wrappedLines = this.wrapText(cleanTitle, cols);
        for (const line of wrappedLines) {
          await this.printLineBold(line);
        }
      } else {
        // Texto normal: envolver y enviar
        const wrappedLines = this.wrapText(rawLine, cols);
        for (const line of wrappedLines) {
          await this.printLine(line);
        }
      }
    }
    await this.printLine(divider);

    // Dimensions
    if (data.dimensions && data.dimensions.length > 0) {
      await this.printLineBold("DIMENSIONES:");
      await this.printLine(data.dimensions.join(", "));
      await this.printLine(divider);
    }

    // Hash
    if (data.hash) {
      await this.setAlignCenter();
      await this.printLine(`ID: ${data.hash}`);
      await this.printLine("apicca.com");
    }

    // Footer
    await this.feed(4);
    // await this.cut(); // Optional, some portable printers don't support cut command
    console.log('Print job finished');
  }

  wrapText(text, limit) {
    const sections = text.split('\n');
    const allLines = [];

    sections.forEach(section => {
      const words = section.split(' ');
      let currentLine = '';

      words.forEach(word => {
        if ((currentLine + word).length > limit) {
          allLines.push(currentLine.trim());
          currentLine = word + ' ';
        } else {
          currentLine += word + ' ';
        }
      });
      allLines.push(currentLine.trim());
    });

    return allLines;
  }
}

export const printer = new PrinterPOS();
