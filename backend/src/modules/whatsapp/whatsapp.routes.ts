import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.js';
import {
  getBridgeStatus,
  startBridgeSocket,
  logoutBridge,
  sendTextMessage,
  sendImageMessage,
  sendDocumentMessage,
} from './whatsapp.service.js';

export async function whatsappRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  // Get WhatsApp bridge status (CONNECTED, QR, CONNECTING, DISCONNECTED)
  app.get('/status', async () => {
    return { data: await getBridgeStatus() };
  });

  // Linking and unlinking the shop's own number is an owner decision: a
  // cashier logging it out stops every bill from being sent until someone
  // rescans the QR on the owner's phone.
  const ownerOnly = { preHandler: [requireRole('ADMIN', 'MANAGER')] };

  // Start WhatsApp bridge / generate fresh QR code
  app.post('/start', ownerOnly, async () => {
    return { data: await startBridgeSocket() };
  });

  // Disconnect / logout current WhatsApp session
  app.post('/logout', ownerOnly, async () => {
    return { data: await logoutBridge() };
  });

  // Direct send text message
  app.post('/send', async (request) => {
    const schema = z.object({
      phone: z.string().min(10, 'Valid phone number required'),
      message: z.string().min(1, 'Message cannot be empty'),
    });
    const { phone, message } = schema.parse(request.body);
    const result = await sendTextMessage(phone, message);
    return { data: result };
  });

  // Direct send image (e.g. invoice PNG)
  app.post('/send-image', {
    bodyLimit: 15 * 1024 * 1024,
  }, async (request) => {
    const schema = z.object({
      phone: z.string().min(10, 'Valid phone number required'),
      image: z.string().min(1, 'Image base64 data required'),
      caption: z.string().optional(),
    });
    const { phone, image, caption } = schema.parse(request.body);
    const result = await sendImageMessage(phone, image, caption);
    return { data: result };
  });

  // Direct send document (e.g. invoice PDF)
  app.post('/send-document', {
    bodyLimit: 15 * 1024 * 1024,
  }, async (request) => {
    const schema = z.object({
      phone: z.string().min(10, 'Valid phone number required'),
      document: z.string().min(1, 'Document base64 data required'),
      filename: z.string().default('invoice.pdf'),
      caption: z.string().optional(),
    });
    const { phone, document, filename, caption } = schema.parse(request.body);
    const result = await sendDocumentMessage(phone, document, filename, caption);
    return { data: result };
  });
}
