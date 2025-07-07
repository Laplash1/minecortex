<div align="center">

# 🧠 MineCortex

**Intelligent Minecraft AI Bot System**

*Autonomous gameplay powered by mineflayer and Voyager-inspired AI*

[![Node.js](https://img.shields.io/badge/Node.js-16.13.0+-green.svg)](https://nodejs.org/)
[![Minecraft](https://img.shields.io/badge/Minecraft-1.21-blue.svg)](https://minecraft.net/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Code Style](https://img.shields.io/badge/Code%20Style-ESLint-purple.svg)](https://eslint.org/)

[🚀 Quick Start](#-quick-start) • [📖 Documentation](docs/) • [🤖 Features](#-features) • [🛠️ Development](#️-development)

</div>

---

## 🎯 What is MineCortex?

**MineCortex** combines the power of **mineflayer** (Minecraft bot framework) with **Voyager-inspired AI capabilities** to create intelligent, autonomous Minecraft bots that can learn, adapt, and coordinate with each other.

> 🧠 **MineCortex** = **Mine** (Mining/My) + **Cortex** (Brain)  
> *Your personal intelligent Minecraft brain system*

### ✨ Key Highlights

- 🤖 **Multi-AI Coordination** - 5 synchronized AI players working together
- 🧠 **Voyager-Inspired Learning** - Memory-based learning without file I/O
- 🎮 **Autonomous Gameplay** - Self-directed exploration, mining, and crafting
- 🛠️ **Extensible Skills** - Modular skill system for custom behaviors
- 🔧 **Simple Setup** - Single command deployment (`npm start`)

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** >= 16.13.0
- **Minecraft Java Edition 1.21** server (local or remote)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/minecortex.git
cd minecortex

# Install dependencies
npm install

# Launch 5 AI players (default)
npm start
```

### 🎮 Customize Your Experience

```bash
# Launch with custom player count
MULTIPLE_PLAYERS_COUNT=3 npm start

# Enable debug mode
DEBUG_MODE=true npm start

# Custom server settings
MINECRAFT_HOST=your-server.com MINECRAFT_PORT=25565 npm start
```

---

## 🤖 Features

### 🧠 AI Capabilities
- **Autonomous Exploration** - Smart pathfinding and world discovery
- **Resource Management** - Intelligent mining and inventory optimization
- **Skill Learning** - Dynamic skill generation and improvement
- **Multi-Player Coordination** - Synchronized teamwork and resource sharing

### 🎮 Minecraft Integration
- **Full Minecraft 1.21 Support** - Latest minecraft-data compatibility
- **Chat Commands** - Natural language and structured command interface
- **Real-time Adaptation** - Responds to game events and player interactions
- **Survival Mechanics** - Food management, health monitoring, respawn handling

### 🛠️ Developer Experience
- **Modular Architecture** - Easy to extend and customize
- **ESLint Integration** - Consistent code quality
- **Comprehensive Documentation** - Detailed guides and references
- **Hot-Reload Development** - Fast iteration cycles

---

## 📊 Performance

| Players | CPU Usage | Memory Usage | Recommended Setup |
|---------|-----------|--------------|-------------------|
| 3 bots  | 10-15%    | 300MB        | Minimum          |
| 5 bots  | 15-25%    | 416MB        | **Recommended**  |
| 10 bots | 30-50%    | 1GB          | High Performance |

*Measured on modern development hardware with real-world workloads*

---

## 🎮 In-Game Commands

```
!status              # Health, food, position report
!goto <x> <y> <z>    # Move to coordinates
!follow <player>     # Track and follow a player
!stop                # Stop current task
!learn               # Show learning statistics
!curriculum          # Generate new AI curriculum
```

---

## 🏗️ Architecture

```
minecortex/
├── 🚀 examples/
│   └── multiple-players.js    # Main entry point
├── 🧠 src/                    # AI Components
│   ├── MinecraftAI.js         # Core AI controller
│   ├── VoyagerAI.js           # Learning engine
│   ├── SkillLibrary.js        # Skill management
│   ├── TaskPlanner.js         # Task orchestration
│   ├── MultiPlayerCoordinator.js # Team coordination
│   └── utils/                 # Shared utilities
├── ⚙️ config/                 # Configuration
├── 📚 docs/                   # Documentation
└── 📝 dev_daily/             # Development logs
```

---

## 🛠️ Development

### Code Quality

```bash
# Check code style
npm run lint

# Auto-fix issues
npm run lint:fix
```

### Environment Variables

```bash
# Minecraft Connection
MINECRAFT_HOST=localhost
MINECRAFT_PORT=25565
MINECRAFT_USERNAME=AIPlayer
MINECRAFT_AUTH=offline

# AI Features (Optional)
OPENAI_API_KEY=your_api_key
OPENAI_MODEL=gpt-4o-mini

# Bot Configuration
DEBUG_MODE=true
AUTO_RESPAWN=true
MULTIPLE_PLAYERS_COUNT=5
```

### 🔧 Extending MineCortex

**Add New Skills:**
```javascript
class MyCustomSkill extends Skill {
  constructor() {
    super('my_skill', 'Description of what this skill does');
  }
  
  async execute(bot, params) {
    // Your implementation here
    return { success: true, result: 'Task completed' };
  }
}
```

---

## 📚 Documentation

| Section | Description |
|---------|-------------|
| [📖 User Guide](docs/guides/user_guide.md) | Complete usage instructions |
| [🔧 Installation Guide](docs/guides/installation.md) | Detailed setup process |
| [🔑 Authentication Setup](docs/guides/authentication.md) | Minecraft account configuration |
| [🤖 Technical Reference](docs/references/technical_reference.md) | Architecture deep-dive |
| [🛠️ Contributing Guide](docs/development/CONTRIBUTING.md) | Development workflow |

---

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](docs/development/CONTRIBUTING.md) for details.

### Development Workflow

1. 🍴 Fork the repository
2. 🌟 Create a feature branch
3. 💻 Make your changes
4. ✅ Run `npm run lint` to ensure code quality
5. 🧪 Test with `npm start`
6. 📝 Update documentation as needed
7. 🚀 Submit a pull request

---

## 📊 Project Status

### ✅ What's Working
- ✅ Multi-player AI coordination (5 bots tested)
- ✅ Autonomous exploration and mining
- ✅ Real-time learning and adaptation
- ✅ Minecraft 1.21 full compatibility
- ✅ Memory-efficient architecture

### 🚧 Upcoming Features
- 🔮 Enhanced natural language processing
- 🏗️ Advanced building and construction
- 🌐 Multi-server support
- 📱 Web dashboard interface

---

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- **[mineflayer](https://github.com/PrismarineJS/mineflayer)** - Excellent Minecraft bot framework
- **[Voyager](https://github.com/MineDojo/Voyager)** - AI learning architecture inspiration (MIT License)
- **[PrismarineJS](https://github.com/PrismarineJS)** - Minecraft protocol implementation
- **[OpenAI](https://openai.com/)** - GPT-4 for intelligent skill generation

---

<div align="center">

**[⬆ Back to Top](#-minecortex)**

Made with ❤️ for the Minecraft AI community

</div>