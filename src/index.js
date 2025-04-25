require('dotenv').config();
const { Client, GatewayIntentBits, Events } = require('discord.js');
const winston = require('winston');
const express = require('express');
const { sendToWebhook, formatMessageForWebhook } = require('./webhookHandler');

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} ${level}: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'bot.log' })
  ],
});

// Express server for health checks
const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON request body
app.use(express.json());

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Test webhook endpoint
app.post('/test-webhook', (req, res) => {
  logger.info('Webhook test received:');
  logger.info(JSON.stringify(req.body, null, 2));
  logger.info('Headers:');
  logger.info(JSON.stringify(req.headers, null, 2));
  
  // Always return success response
  res.status(200).json({ status: 'success', message: 'Webhook test received' });
});

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Test webhook available at http://localhost:${PORT}/test-webhook`);
});

// Discord bot setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});
require('dotenv').config({ debug: true });   // already there? just add debug:true

console.log(
  'DEBUG • MONITORED_CHANNEL_ID raw:',
  JSON.stringify(process.env.MONITORED_CHANNEL_ID),
  '(length',
  (process.env.MONITORED_CHANNEL_ID || '').length + ')'
);


// Get monitored channel ID
const monitoredChannelId = process.env.MONITORED_CHANNEL_ID || '';

// Get webhook URL
const webhookUrl = process.env.WEBHOOK_URL || '';
let testWebhookUrl = null;

// Add test webhook URL for testing purposes
if (process.env.NODE_ENV !== 'production') {
  testWebhookUrl = `http://localhost:${PORT}/test-webhook`;
  logger.info(`Adding test webhook URL: ${testWebhookUrl}`);
}

client.once(Events.ClientReady, () => {
  logger.info(`Logged in as ${client.user.tag}`);
  logger.info(`Monitoring channel: ${monitoredChannelId}`);
});

client.on(Events.MessageCreate, async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;

  // Check if the message is in the monitored channel
  if (message.channelId === monitoredChannelId) {
    logger.info(`Message received in monitored channel: ${message.content.substring(0, 50)}...`);
    
    // Try sending to both the real webhook and test webhook (if available)
    const sendPromises = [];
    
    if (webhookUrl) {
      try {
        // Format message for webhook
        const payload = formatMessageForWebhook(message);
        
        // Send to real webhook
        logger.info('Sending to real webhook...');
        sendPromises.push(sendToWebhook(webhookUrl, payload));
        
        // Send to test webhook if available
        if (testWebhookUrl) {
          logger.info('Sending to test webhook...');
          sendPromises.push(sendToWebhook(testWebhookUrl, payload));
        }
        
        await Promise.allSettled(sendPromises);
        logger.info(`Completed webhook sending for message ${message.id}`);
      } catch (error) {
        logger.error(`Failed to send message to webhook: ${error.message}`);
      }
    } else {
      logger.warn('No webhook URL configured');
    }
  }
});

// Error handling
client.on(Events.Error, (error) => {
  logger.error(`Discord client error: ${error.message}`);
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN)
  .catch(error => {
    logger.error(`Failed to login: ${error.message}`);
    process.exit(1);
  });

// Handle process termination
process.on('SIGINT', () => {
  logger.info('Bot is shutting down...');
  client.destroy();
  process.exit(0);
});

process.on('unhandledRejection', (error) => {
  logger.error(`Unhandled rejection: ${error.message}`);
}); 
