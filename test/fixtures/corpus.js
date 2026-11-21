// Original study texts written for Cerebro's tests. Each entry is a list of pages.
const computer = [
    [
        { h1: 'Computer Hardware Basics' },
        { p: 'A computer is an electronic device that accepts data, processes it according to instructions, and produces information.' },
        { h2: 'Hardware and Software' },
        { p: 'Hardware refers to the physical parts of a computer, such as the keyboard, monitor, and system unit. Software is the set of instructions that tells the hardware what to do.' }
    ],
    [
        { h1: 'Memory' },
        { h2: 'Random Access Memory' },
        { p: 'Random Access Memory (RAM) is the main working memory of a computer. It temporarily holds the data and program instructions that the processor is currently using. RAM is volatile, which means its contents are lost when the power is turned off.' },
        { p: 'Because the processor can read RAM much faster than a hard disk, programs are loaded into RAM before they run. A computer with too little RAM must keep moving data back and forth to storage, which makes it slow.' },
        { h2: 'Read Only Memory' },
        { p: 'Read Only Memory (ROM) stores permanent instructions, such as the startup program. ROM is non-volatile, so its contents remain when the computer is switched off.' }
    ],
    [
        { h1: 'Storage Devices' },
        { p: 'Storage devices keep data and programs for long-term use. Unlike RAM, storage is non-volatile.' },
        { list: ['A hard disk drive stores data on spinning magnetic platters.', 'A solid-state drive stores data in flash memory and has no moving parts.', 'A USB flash drive is a small portable storage device.'] },
        { h2: 'Comparing Storage' },
        { table: [['Device', 'Speed', 'Typical capacity'], ['Hard disk drive', 'Moderate', '1 TB to 4 TB'], ['Solid-state drive', 'Fast', '256 GB to 2 TB'], ['USB flash drive', 'Slow to moderate', '16 GB to 256 GB']] }
    ],
    [
        { h1: 'Input and Output Devices' },
        { p: 'Input devices send data into the computer. Examples include the keyboard, mouse, scanner, and microphone.' },
        { p: 'Output devices present processed information to the user. Examples include the monitor, printer, and speakers.' },
        { h2: 'The Central Processing Unit' },
        { p: 'The Central Processing Unit (CPU) carries out program instructions. It contains the arithmetic logic unit, which performs calculations and comparisons, and the control unit, which directs the flow of data.' }
    ]
];

const networking = [
    [
        { h1: 'Introduction to Computer Networks' },
        { p: 'A computer network is a group of two or more connected computers that share resources and exchange data. Networks let users share files, printers, and an internet connection.' },
        { h2: 'How Computers Communicate' },
        { p: 'When two computers communicate, the sending computer breaks the message into small units called packets. Each packet carries the address of the destination. Network devices forward the packets, and the receiving computer reassembles them into the original message. A set of rules called a protocol makes sure both computers understand each other.' }
    ],
    [
        { h1: 'Types of Networks' },
        { h2: 'Local Area Network' },
        { p: 'A Local Area Network (LAN) connects computers within a small area such as a home, a school, or an office building. LANs are usually owned by one organization and offer high data transfer speeds.' },
        { h2: 'Wide Area Network' },
        { p: 'A Wide Area Network (WAN) connects computers across cities, countries, or continents. The internet is the largest WAN. WANs often use leased telecommunication lines and are slower and more expensive than LANs.' },
        { h2: 'Metropolitan Area Network' },
        { p: 'A Metropolitan Area Network (MAN) covers a city or a large campus. It is larger than a LAN but smaller than a WAN.' }
    ],
    [
        { h1: 'Network Topologies' },
        { p: 'A network topology is the arrangement of the devices and cables in a network. The topology affects cost, performance, and how the network behaves when a cable or device fails.' },
        { h2: 'Bus Topology' },
        { p: 'In a bus topology, all devices share a single main cable called the backbone. It is cheap and easy to install, but if the backbone fails the whole network stops working, and performance drops as more devices are added.' },
        { h2: 'Star Topology' },
        { p: 'In a star topology, every device connects to a central switch or hub. If one cable fails, only that device is affected, which makes faults easy to find. However, if the central switch fails, the entire network goes down.' }
    ],
    [
        { h2: 'Ring Topology' },
        { p: 'In a ring topology, each device connects to exactly two neighbors, forming a closed loop. Data travels around the ring in one direction. A single break in the ring can disrupt the whole network.' },
        { h2: 'Mesh Topology' },
        { p: 'In a mesh topology, devices have multiple paths to one another. Mesh networks are very reliable because data can take another route when a link fails, but they need a lot of cabling and are expensive.' },
        { table: [['Topology', 'Main advantage', 'Main disadvantage'], ['Bus', 'Low cost', 'Backbone is a single point of failure'], ['Star', 'Easy to find faults', 'Central switch can fail'], ['Ring', 'Orderly data flow', 'One break stops the ring'], ['Mesh', 'High reliability', 'Expensive cabling']] }
    ],
    [
        { h1: 'Network Devices' },
        { p: 'A switch connects devices within a LAN and sends data only to the device it is meant for. A router connects different networks and chooses the best path for data between them.' },
        { p: 'A modem converts digital signals from a computer into signals that can travel over telephone or cable lines. A hub is an older device that sends incoming data to every connected device.' }
    ]
];

const databases = [
    [
        { h1: 'Database Fundamentals' },
        { p: 'A database is an organized collection of related data that can be easily accessed, managed, and updated. A database management system (DBMS) is the software used to create and manage databases.' },
        { h2: 'Why Databases Are Needed' },
        { p: 'Databases reduce data redundancy, keep data consistent, and allow many users to work with the same data at the same time. They also enforce security rules that control who can read or change the data.' }
    ],
    [
        { h1: 'Tables and Keys' },
        { p: 'A relational database stores data in tables. Each table is made of rows, called records, and columns, called fields.' },
        { h2: 'Primary Key' },
        { p: 'A primary key is a field, or a combination of fields, that uniquely identifies each record in a table. A primary key cannot contain duplicate values and cannot be empty. When a user tries to insert a record with a primary key value that already exists, the database rejects the new record.' },
        { h2: 'Foreign Key' },
        { p: 'A foreign key is a field in one table that refers to the primary key of another table. Foreign keys create relationships between tables and keep the data in related tables consistent.' }
    ],
    [
        { h1: 'Normalization' },
        { p: 'Normalization is the process of organizing tables to reduce redundancy and avoid update anomalies. It divides large tables into smaller related tables and links them with keys.' },
        { h2: 'First Normal Form' },
        { p: 'A table is in first normal form (1NF) when every field contains a single, indivisible value and there are no repeating groups.' },
        { h2: 'Second Normal Form' },
        { p: 'A table is in second normal form (2NF) when it is in 1NF and every non-key field depends on the whole primary key, not just part of it.' },
        { h2: 'Third Normal Form' },
        { p: 'A table is in third normal form (3NF) when it is in 2NF and no non-key field depends on another non-key field.' }
    ],
    [
        { h1: 'Queries' },
        { p: 'A query is a request for data from a database. Structured Query Language (SQL) is the standard language used to write queries. The SELECT statement retrieves data, and the WHERE clause filters the rows that are returned.' }
    ]
];

const operatingSystems = [
    [
        { h1: 'Operating Systems' },
        { p: 'An operating system (OS) is system software that manages hardware and provides services for application programs. Examples are Windows, macOS, and Linux.' },
        { h2: 'Memory Management' },
        { p: 'The operating system decides which programs get space in RAM. When RAM is full, the operating system moves inactive data to a reserved area of the storage drive called virtual memory. Virtual memory lets more programs run at once, but it is much slower than RAM.' },
        { h2: 'File Management' },
        { p: 'The operating system organizes data into files and folders and controls who can open them.' }
    ]
];

const scanned = [
    [
        { h1: 'Chapter 5 Photosynthesis' },
        { p: 'Photosynthesis is the process plants use to turn light energy into chemical energy.' }
    ],
    [{ image: true }],
    [{ image: true }]
];

module.exports = { computer, networking, databases, operatingSystems, scanned };
