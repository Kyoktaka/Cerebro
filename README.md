# Cerebro: A Web-Based Interactive Chatbot for PDF-Based Study Assistance

<div align="center">

![Cerebro Banner](https://img.shields.io/badge/Cerebro-AI%20Study%20Assistant-gold?style=for-the-badge&logo=google&logoColor=white)
![Version](https://img.shields.io/badge/version-1.0.0-blue?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)
![Node](https://img.shields.io/badge/Node.js-18.x-339933?style=flat-square&logo=nodedotjs)
![Gemini](https://img.shields.io/badge/Gemini-2.0%20Flash-4285F4?style=flat-square&logo=google)

**Your intelligent AI study assistant powered by Google Gemini**

[Features](##features) • [Demo](##demo) • [Installation](##installation) • [Usage](##usage) • [Tech Stack](##tech-stack) • [Team](##team)

</div>


## 📖 About

Cerebro is a smart study assistant that allows you to upload PDF documents and ask questions based strictly on their content. Using Google's Gemini AI with a built-in **anti-hallucination engine**, Cerebro ensures that all answers come ONLY from your uploaded materials - no made-up information, no outside knowledge.

### Why Cerebro?

| Problem | Cerebro Solution |
|---------|------------------|
| ❌ Generic AI answers from unknown sources | ✅ Answers strictly from YOUR documents |
| ❌ Hallucinations and made-up facts | ✅ 5-rule anti-hallucination system |
| ❌ Can't manage multiple documents | ✅ Upload up to 10 PDFs, focus on specific ones |
| ❌ No chat history | ✅ Conversations saved automatically |

---

## ✨ Features

### 📄 PDF Management
- **Upload** up to 10 PDF files (10MB max each)
- **PDF Chips** - Clickable file names in study mode
- **PDF Manager Panel** - Checkbox interface to manage documents
- **Focus Mode** - Select which PDFs the AI should use
- **Delete Individual PDFs** - Remove specific documents without clearing all

### 🛡️ Anti-Hallucination Engine
Enforces 5 strict rules on every AI response:

1. ✅ ONLY answer using PDF content
2. ✅ NO outside knowledge or pre-trained data
3. ✅ Answer in the same language as the user
4. ✅ Summarize the document if asked
5. ✅ Say "cannot answer" if information not in PDF

### 💬 Chat Features
- **Real-time conversations** with AI
- **Conversation history** saved per user
- **Auto-title** based on first message
- **Edit/Delete** conversations
- **PDF Mode indicator** (green bar + badge)

### 🔐 Account Management
- **Register** with first name, last name, email, password
- **Login** with last name (username) and password
- **Forgot Password** - retrieve password via username
- **Delete Account** - permanently remove all user data

---

## 🎥 Demo

### Upload PDF & Ask Question

```
User: Uploads "Biology_Textbook.pdf"
System: ✅ PDF Upload Complete!
        📊 Stats: 1/10 PDFs | 45K characters
        📚 PDF Mode active.

User: "What is photosynthesis?"
AI: "Based on your uploaded document 'Biology_Textbook.pdf', 
     photosynthesis is the process by which plants convert 
     sunlight into energy..."

User: "What is the capital of France?"
AI: "I cannot answer that based on your uploaded document. 
     Your PDF is about biology. Please ask about the content 
     of your PDF."
```

### PDF Manager Panel

```
┌─────────────────────────────────────────────────────────────┐
│  Manage PDFs (3/10)                                    [✕]  │
├─────────────────────────────────────────────────────────────┤
│  ✅ Biology_Textbook.pdf                                    │
│  ☐ Chemistry_Notes.pdf                                      │
│  ✅ Physics_Formulas.pdf                                    │
├─────────────────────────────────────────────────────────────┤
│  [Select All]  [Apply Focus]  [Delete Checked]              │
└─────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Tech Stack

| Technology | Purpose |
|------------|---------|
| **HTML5** | Structure |
| **CSS3** | Styling & animations |
| **JavaScript (ES6+)** | Frontend logic |
| **Node.js + Express** | Backend server |
| **Google Gemini API** | AI language model |
| **pdf-parse** | PDF text extraction |
| **multer** | File upload handling |
| **JSON File Storage** | User & conversation persistence |

---

## 📦 Installation

### Prerequisites

- Node.js (v18 or higher)
- Google Gemini API key ([Get one here](https://aistudio.google.com/))

### Steps

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/cerebro.git
cd cerebro
```

2. **Install dependencies**
```bash
npm install
```

3. **Set up environment variables**
Create a `.env` file in the root directory:
```env
GEMINI_API_KEY=your_gemini_api_key_here
PORT=8080
```

4. **Start the server**
```bash
node server.js
```

5. **Open your browser**
```
http://localhost:8080
```

### Project Structure

```
cerebro/
├── index.html              # Landing page
├── login.html              # Login page
├── register.html           # Registration page
├── about.html              # About page
├── chat.html               # Main chat interface
├── css/
│   ├── style.css           # Global styles
│   └── chat.css            # Chat & PDF Manager styles
├── js/
│   ├── main.js             # Homepage logic
│   ├── auth.js             # Authentication logic
│   └── chat.js             # Chat & PDF logic
├── server.js               # Backend API
├── users/                  # User JSON files (auto-created)
├── uploads/                # Temp uploads (auto-created)
├── .env                    # Environment variables
└── package.json            # Dependencies
```

---

## 🚀 Usage Guide

### 1. Create an Account
- Go to `register.html`
- Enter First Name, Last Name (username), Email, Password
- Click "Create Account"

### 2. Login
- Go to `login.html`
- Enter Last Name (username) and Password
- Click "Login"

### 3. Upload PDF
- Click the paperclip icon 📎
- Select "Upload PDF"
- Choose one or more PDF files (max 10, 10MB each)

### 4. Ask Questions
- Type your question in the chat input
- Press Enter or click Send ✈️
- AI answers based ONLY on your PDFs

### 5. Manage PDFs
- Click any PDF chip (green pill) OR the "Manage" button
- Check/uncheck PDFs to focus on
- Click "Apply Focus" - AI will only use selected PDFs
- Click "Delete Checked" - Remove specific PDFs

### 6. Exit PDF Mode
- Click the red "Exit PDF Mode" button
- Returns to normal chat mode

### 7. Manage Conversations
- **New Chat** - Click "New Chat" button in sidebar
- **Edit Title** - Hover conversation → Click edit icon
- **Delete** - Hover conversation → Click delete icon

### 8. Account Settings
- **Logout** - Click "Logout" in sidebar footer
- **Delete Account** - Click "Delete Account" (requires confirmation)

---

## 🔧 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/register` | POST | Create new user account |
| `/api/auth/login` | POST | Authenticate user |
| `/api/auth/logout` | POST | End user session |
| `/api/auth/delete-account` | POST | Permanently delete account |
| `/api/auth/forgot-password` | POST | Retrieve password |
| `/api/conversations/:sessionId` | GET | Get all conversations |
| `/api/conversations/create` | POST | Create new conversation |
| `/api/upload` | POST | Upload PDF files |
| `/api/chat` | POST | Send message to AI |
| `/api/conversations/:sessionId/focus-pdf` | POST | Focus on selected PDFs |
| `/api/conversations/:sessionId/delete-pdf` | POST | Delete individual PDF |
| `/api/conversations/:sessionId/clear-pdfs` | POST | Clear all PDFs |


## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- **Google Gemini AI** - For providing the powerful language model
- **Font Awesome** - For the beautiful icons
- **Google Fonts** - For the Inter font family

# Initialize git repository
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit: Cerebro AI Study Assistant"

# Add remote (replace with your repo URL)
git remote add origin https://github.com/yourusername/cerebro.git

# Push to GitHub
git branch -M main
git push -u origin main

<div align="center">
  
**Made with 🧠 by Team Cerebro**

</div>
