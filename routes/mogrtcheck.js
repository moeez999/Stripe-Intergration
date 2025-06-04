const express = require('express');
const router = express.Router();

// POST /api/mogrtcheck/latest-mogrts
router.post('/latest-mogrts', (req, res) => {
  console.log('Received request for latest MoGRTs');  
  try {
    const response = {
      version: "1.0.0",
      mogrts: [
        { 
          name: "MOGRT_Files.zip",
          url: "https://cutpilot.s3.us-west-2.amazonaws.com/MOGRT/MOGRT_Files.zip"
        }
      ]
    };

    // Set proper content type header
    res.setHeader('Content-Type', 'application/json');
    console.log('Sending response:', response);
    res.json(response);
  } catch (error) {
    console.error('Error in /latest-mogrts endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
