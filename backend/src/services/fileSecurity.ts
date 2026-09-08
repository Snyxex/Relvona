import path from "path";
import crypto from "crypto";

export interface FileValidationResult {
  isValid: boolean;
  securityStatus: "SAFE" | "SUSPICIOUS" | "QUARANTINED";
  mimeType: string;
  sanitizedFilename: string;
  detectedIssues: string[];
}

export class FileSecurity {
  // Inspect Magic Bytes for PDF format (%PDF-)
  static isPdfMagicBytes(buffer: Buffer): boolean {
    if (buffer.length < 5) return false;
    return (
      buffer[0] === 0x25 && // %
      buffer[1] === 0x50 && // P
      buffer[2] === 0x44 && // D
      buffer[3] === 0x46 && // F
      buffer[4] === 0x2d    // -
    );
  }

  // Sanitize Filename & prevent Path Traversal
  static sanitizeFilename(originalFilename: string): string {
    // Remove null bytes, directory traversal patterns, and control characters
    const cleanBasename = path.basename(originalFilename).replace(/[\0\x00-\x1f\x7f]/g, "");
    const safeExt = path.extname(cleanBasename).toLowerCase();
    const uniquePrefix = crypto.randomUUID();

    return `doc_${uniquePrefix}${safeExt}`;
  }

  // Scan text for RAG Poisoning / Prompt Injection attempt patterns
  static scanForPoisoningPatterns(text: string): { isSuspicious: boolean; issues: string[] } {
    const issues: string[] = [];
    const lower = text.toLowerCase();

    const suspiciousPatterns = [
      { pattern: /ignore\s+(all\s+)?(previous\s+)?instructions/gi, reason: "Instruction override pattern" },
      { pattern: /reveal\s+(the\s+)?system\s+prompt/gi, reason: "System prompt extraction pattern" },
      { pattern: /output\s+(the\s+)?(admin|administrator|database)\s+password/gi, reason: "Credential harvesting pattern" },
      { pattern: /you\s+are\s+now\s+in\s+developer\s+mode/gi, reason: "Jailbreak activation pattern" },
      { pattern: /act\s+as\s+an\s+unrestricted\s+ai/gi, reason: "Persona jailbreak pattern" },
      { pattern: /<script\b[^<]*>([\s\S]*?)<\/script>/gi, reason: "Embedded HTML Script tag" },
      { pattern: /javascript:/gi, reason: "URI Script Injection pattern" },
    ];

    suspiciousPatterns.forEach(({ pattern, reason }) => {
      if (pattern.test(lower)) {
        issues.push(reason);
      }
    });

    return {
      isSuspicious: issues.length > 0,
      issues,
    };
  }

  // Validate uploaded buffer, file size, MIME type, and RAG Poisoning state
  static validateUploadedFile(
    fileBuffer: Buffer,
    originalFilename: string,
    declaredMimeType: string
  ): FileValidationResult {
    const issues: string[] = [];
    const maxSizeBytes = 10 * 1024 * 1024; // 10MB Cap

    // 1. Size Limit Validation
    if (fileBuffer.length > maxSizeBytes) {
      issues.push("File size exceeds maximum allowed limit (10MB)");
      return {
        isValid: false,
        securityStatus: "QUARANTINED",
        mimeType: declaredMimeType,
        sanitizedFilename: "",
        detectedIssues: issues,
      };
    }

    const sanitizedFilename = this.sanitizeFilename(originalFilename);
    const ext = path.extname(originalFilename).toLowerCase();

    // 2. Format & Magic Byte Validation
    let confirmedMime = declaredMimeType;

    if (ext === ".pdf") {
      if (!this.isPdfMagicBytes(fileBuffer)) {
        issues.push("Magic Byte mismatch: File header does not match valid PDF structure.");
        return {
          isValid: false,
          securityStatus: "QUARANTINED",
          mimeType: declaredMimeType,
          sanitizedFilename,
          detectedIssues: issues,
        };
      }
      confirmedMime = "application/pdf";
    } else if (ext === ".png") {
      if (!fileBuffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) { issues.push("Magic Byte mismatch: invalid PNG"); return { isValid: false, securityStatus: "QUARANTINED", mimeType: declaredMimeType, sanitizedFilename, detectedIssues: issues }; }
      confirmedMime = "image/png";
    } else if (ext === ".jpg" || ext === ".jpeg") {
      if (fileBuffer.length < 3 || fileBuffer[0] !== 0xff || fileBuffer[1] !== 0xd8 || fileBuffer[2] !== 0xff) { issues.push("Magic Byte mismatch: invalid JPEG"); return { isValid: false, securityStatus: "QUARANTINED", mimeType: declaredMimeType, sanitizedFilename, detectedIssues: issues }; }
      confirmedMime = "image/jpeg";
    } else if (ext === ".webp") {
      if (fileBuffer.subarray(0, 4).toString() !== "RIFF" || fileBuffer.subarray(8, 12).toString() !== "WEBP") { issues.push("Magic Byte mismatch: invalid WEBP"); return { isValid: false, securityStatus: "QUARANTINED", mimeType: declaredMimeType, sanitizedFilename, detectedIssues: issues }; }
      confirmedMime = "image/webp";
    } else if ([".txt", ".md", ".json", ".faq"].includes(ext)) {
      confirmedMime = "text/plain";
    } else {
      issues.push(`Prohibited file extension '${ext}'. Only PDF, TXT, MD, and FAQ files are allowed.`);
      return {
        isValid: false,
        securityStatus: "QUARANTINED",
        mimeType: declaredMimeType,
        sanitizedFilename,
        detectedIssues: issues,
      };
    }

    // 3. Scan Text for RAG Poisoning Patterns
    const textContent = fileBuffer.toString("utf8", 0, Math.min(fileBuffer.length, 50000));
    const poisoningScan = this.scanForPoisoningPatterns(textContent);

    let securityStatus: "SAFE" | "SUSPICIOUS" | "QUARANTINED" = "SAFE";
    if (poisoningScan.isSuspicious) {
      securityStatus = "SUSPICIOUS";
      issues.push(...poisoningScan.issues);
    }

    return {
      isValid: true,
      securityStatus,
      mimeType: confirmedMime,
      sanitizedFilename,
      detectedIssues: issues,
    };
  }
}
