import bodyParser from "body-parser";
import express from "express";
import { createServer } from "http";
import path from "path";
import multer from "multer";
import { spawn } from "child_process";
import fs from "fs";

const storage = multer.diskStorage({
  destination(req, file, callback) {
    callback(null, path.resolve(__dirname, "../uploads"));
  },
  filename(req, file, callback) {
    const uniqueSuffix = Math.random().toString(26).substring(4, 10);
    callback(null, `${Date.now()}-${uniqueSuffix}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  fileFilter(req, file, callback) {
    console.log(file.mimetype);
    if (file.mimetype.includes("video/")) {
      callback(null, true);
      return;
    }
    callback(new TypeError("Invalid File Type"));
  },
});

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use("/public", express.static(path.resolve(__dirname, "../public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.post("/", upload.single("file"), async (req, res) => {
  const controller = new AbortController();

  try {
    if (!req.file) throw Error("A file must be provided.");

    const filename = req.file.filename;
    const filenameWithoutExtension = filename.split(".")[0];
    const result = await Promise.race<string>([
      new Promise((resolve, reject) => {
        const childProcess = spawn(
          `ffmpeg -i uploads/${filename} -c:v libx264 -preset veryfast -r 30 -vf "scale=720:-1" -c:a copy converted/${filenameWithoutExtension}.mp4`,
          {
            shell: true,
            signal: controller.signal,
          }
        );

        childProcess.on("exit", (code, signal) => {
          if (code !== 0) {
            reject(`Child process failed with exit code: ${code}`);
          }
          resolve(`${filenameWithoutExtension}.mp4`);
        });
      }),
      new Promise((_, reject) => setTimeout(() => reject("Process exceeded time limit."), 10)),
    ]);

    new Promise((reject, resolve) => {
      const stream = fs.createReadStream(path.resolve(__dirname, "../converted", result));
      stream.on("open", () => {
        res.attachment(result); // ここでダウンロードしてもらうファイル名を指定する
        stream.pipe(res);
      });

      stream.on("error", (err) => {
        reject("Converted file could not be read.");
      });

      stream.on("close", () => resolve(48));
    }).finally(() => spawn(`rm uploads/${filename} && rm converted/${result}`, { shell: true }));

    res.statusCode = 200;
    res.send(result);
  } catch (error) {
    res.statusCode = 500;
    res.send(error);
  }
});

const server = createServer(app);
const port = 4000;
server.listen(port, () => console.log("Listening on port: ", port));
