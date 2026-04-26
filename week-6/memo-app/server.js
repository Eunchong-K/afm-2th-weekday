require('dotenv').config();
const express = require('express');
const ImageKit = require('imagekit');
const path = require('path');

const app = express();

const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY.trim(),
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY.trim(),
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT.trim(),
});

app.use(express.static(path.join(__dirname)));

app.get('/auth', (req, res) => {
  try {
    const authParams = imagekit.getAuthenticationParameters();
    res.json({
      success: true,
      data: {
        ...authParams,
        publicKey: process.env.IMAGEKIT_PUBLIC_KEY.trim(),
        urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT.trim(),
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
