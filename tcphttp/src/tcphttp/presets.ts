/**
 * @module presets
 * シミュレーション用のプリセット定義モジュール。
 * TCP/HTTPの代表的な通信パターン（ハンドシェイク、データ送受信、
 * HTTP GET/POST、Keep-Alive、RST、エラーレスポンスなど）を
 * セレクトボックスから選択可能なプリセットとして提供する。
 */

import type { Preset, HttpRequest, HttpResponse, SocketAddr } from "./types.js";

/** クライアント側のデフォルトアドレス（プライベートIP） */
const CLIENT: SocketAddr = { ip: "192.168.1.10", port: 50000 };
/** サーバー側のデフォルトアドレス（example.comのIP） */
const SERVER: SocketAddr = { ip: "93.184.216.34", port: 80 };

/**
 * HTTPリクエストオブジェクトを簡易的に生成するヘルパー。
 * HTTP/1.1をデフォルトバージョンとし、Hostヘッダを自動付与する。
 * @param method - HTTPメソッド
 * @param path - リクエストパス
 * @param headers - 追加のHTTPヘッダ
 * @param body - リクエストボディ
 * @returns HTTPリクエストオブジェクト
 */
function httpReq(method: "GET" | "POST" | "PUT" | "DELETE" | "HEAD" | "OPTIONS", path: string, headers: Record<string, string> = {}, body?: string): HttpRequest {
  return { method, path, version: "1.1", headers: { Host: "example.com", ...headers }, body };
}

/**
 * HTTPレスポンスオブジェクトを簡易的に生成するヘルパー。
 * HTTP/1.1をデフォルトバージョンとし、Content-Typeヘッダを自動付与する。
 * @param code - HTTPステータスコード
 * @param text - ステータステキスト
 * @param headers - 追加のHTTPヘッダ
 * @param body - レスポンスボディ
 * @returns HTTPレスポンスオブジェクト
 */
function httpRes(code: number, text: string, headers: Record<string, string> = {}, body?: string): HttpResponse {
  return { statusCode: code, statusText: text, version: "1.1", headers: { "Content-Type": "text/html", ...headers }, body };
}

/** シミュレーション用プリセットの一覧 */
export const presets: Preset[] = [
  // 1. TCP 3ウェイハンドシェイク
  {
    name: "1. TCP 3ウェイハンドシェイク",
    description: "SYN → SYN+ACK → ACK の3ステップでTCPコネクションを確立。各ステップでのシーケンス番号・ACK番号の変化を観察。",
    clientAddr: CLIENT, serverAddr: SERVER,
    ops: [
      { type: "socket_create", side: "client" },
      { type: "socket_create", side: "server" },
      { type: "bind", side: "server", port: 80 },
      { type: "listen", side: "server" },
      { type: "connect", side: "client" },
      { type: "accept", side: "server" },
    ],
  },

  // 2. データ送受信
  {
    name: "2. TCPデータ送受信 — PSH+ACKとACK応答",
    description: "ESTABLISHED後にデータを送受信。PSH+ACKでデータ送信し、ACKで確認応答。シーケンス番号がデータ長分だけ進む。",
    clientAddr: CLIENT, serverAddr: SERVER,
    ops: [
      { type: "socket_create", side: "client" },
      { type: "socket_create", side: "server" },
      { type: "bind", side: "server", port: 80 },
      { type: "listen", side: "server" },
      { type: "connect", side: "client" },
      { type: "send", side: "client", data: "Hello, Server!" },
      { type: "recv", side: "server" },
      { type: "send", side: "server", data: "Hello, Client!" },
      { type: "recv", side: "client" },
    ],
  },

  // 3. TCP 4ウェイ切断
  {
    name: "3. TCP 4ウェイ切断 — FINハンドシェイク",
    description: "FIN → ACK → FIN → ACK の4ステップで丁寧にコネクションを切断。TIME_WAIT状態への遷移も確認。",
    clientAddr: CLIENT, serverAddr: SERVER,
    ops: [
      { type: "socket_create", side: "client" },
      { type: "socket_create", side: "server" },
      { type: "bind", side: "server", port: 80 },
      { type: "listen", side: "server" },
      { type: "connect", side: "client" },
      { type: "send", side: "client", data: "data" },
      { type: "close", side: "client" },
    ],
  },

  // 4. HTTP GET リクエスト
  {
    name: "4. HTTP GET — 基本的なWebページ取得",
    description: "TCP接続確立 → HTTP GETリクエスト送信 → HTTPレスポンス受信。リクエスト/レスポンスがTCPセグメントで運ばれる過程を観察。",
    clientAddr: CLIENT, serverAddr: SERVER,
    ops: [
      { type: "socket_create", side: "client" },
      { type: "socket_create", side: "server" },
      { type: "bind", side: "server", port: 80 },
      { type: "listen", side: "server" },
      { type: "connect", side: "client" },
      { type: "http_request", request: httpReq("GET", "/index.html", { "Accept": "text/html", "User-Agent": "Mozilla/5.0" }) },
      { type: "http_response", response: httpRes(200, "OK", { "Content-Length": "45", "Connection": "keep-alive" }, "<html><body><h1>Hello!</h1></body></html>") },
    ],
  },

  // 5. HTTP POST リクエスト
  {
    name: "5. HTTP POST — データ送信",
    description: "POSTリクエストでサーバーにデータ送信。Content-Typeヘッダとボディの関係、201 Createdレスポンスを観察。",
    clientAddr: CLIENT, serverAddr: SERVER,
    ops: [
      { type: "socket_create", side: "client" },
      { type: "socket_create", side: "server" },
      { type: "bind", side: "server", port: 80 },
      { type: "listen", side: "server" },
      { type: "connect", side: "client" },
      { type: "http_request", request: httpReq("POST", "/api/users", {
        "Content-Type": "application/json", "Content-Length": "32",
      }, '{"name":"Alice","age":30}') },
      { type: "http_response", response: httpRes(201, "Created", {
        "Content-Type": "application/json", "Location": "/api/users/42",
      }, '{"id":42,"name":"Alice","age":30}') },
    ],
  },

  // 6. HTTP Keep-Alive（複数リクエスト）
  {
    name: "6. Keep-Alive — TCP再利用で複数リクエスト",
    description: "HTTP/1.1のKeep-Aliveで1つのTCP接続上で複数のHTTPリクエストを連続送信。接続確立コストの削減。",
    clientAddr: CLIENT, serverAddr: SERVER,
    ops: [
      { type: "socket_create", side: "client" },
      { type: "socket_create", side: "server" },
      { type: "bind", side: "server", port: 80 },
      { type: "listen", side: "server" },
      { type: "connect", side: "client" },
      { type: "http_request", request: httpReq("GET", "/page1.html") },
      { type: "http_response", response: httpRes(200, "OK", { "Connection": "keep-alive" }, "<html>Page 1</html>") },
      { type: "http_request", request: httpReq("GET", "/page2.html") },
      { type: "http_response", response: httpRes(200, "OK", { "Connection": "keep-alive" }, "<html>Page 2</html>") },
      { type: "http_request", request: httpReq("GET", "/page3.html") },
      { type: "http_response", response: httpRes(200, "OK", { "Connection": "close" }, "<html>Page 3</html>") },
      { type: "close", side: "client" },
    ],
  },

  // 7. HTTP/1.0 (Connection: close)
  {
    name: "7. HTTP/1.0 — 1リクエスト1コネクション",
    description: "HTTP/1.0ではリクエストごとにTCP接続を確立・切断。HTTP/1.1のKeep-Aliveとのコスト差を比較。",
    clientAddr: CLIENT, serverAddr: SERVER,
    ops: [
      { type: "socket_create", side: "client" },
      { type: "socket_create", side: "server" },
      { type: "bind", side: "server", port: 80 },
      { type: "listen", side: "server" },
      { type: "connect", side: "client" },
      { type: "http_request", request: { method: "GET", path: "/", version: "1.0", headers: { Host: "example.com" } } },
      { type: "http_response", response: { statusCode: 200, statusText: "OK", version: "1.0",
        headers: { "Content-Type": "text/html", "Connection": "close" }, body: "<html>Hello</html>" } },
      { type: "close", side: "server" },
    ],
  },

  // 8. RST（異常切断）
  {
    name: "8. RST — コネクション異常リセット",
    description: "RSTパケットによる即座のコネクション切断。FINハンドシェイクなしで強制終了。ポート不達やエラー時に使用。",
    clientAddr: CLIENT, serverAddr: SERVER,
    ops: [
      { type: "socket_create", side: "client" },
      { type: "socket_create", side: "server" },
      { type: "bind", side: "server", port: 80 },
      { type: "listen", side: "server" },
      { type: "connect", side: "client" },
      { type: "send", side: "client", data: "Some data" },
      { type: "rst", side: "server" },
    ],
  },

  // 9. HTTP エラーレスポンス
  {
    name: "9. HTTPエラー — 404 / 500 レスポンス",
    description: "存在しないパスへのリクエスト(404)とサーバーエラー(500)。ステータスコードの意味とレスポンスボディを確認。",
    clientAddr: CLIENT, serverAddr: SERVER,
    ops: [
      { type: "socket_create", side: "client" },
      { type: "socket_create", side: "server" },
      { type: "bind", side: "server", port: 80 },
      { type: "listen", side: "server" },
      { type: "connect", side: "client" },
      { type: "http_request", request: httpReq("GET", "/not-found") },
      { type: "http_response", response: httpRes(404, "Not Found", {}, "<html><h1>404 Not Found</h1></html>") },
      { type: "http_request", request: httpReq("POST", "/api/crash") },
      { type: "http_response", response: httpRes(500, "Internal Server Error", {}, '{"error":"unexpected"}') },
    ],
  },

  // 10. 全体フロー（接続→HTTP→切断）
  {
    name: "10. 全体フロー — socket→connect→HTTP→close",
    description: "ソケットAPI呼び出しからTCPハンドシェイク、HTTPリクエスト/レスポンス、切断まで全プロセスを一通り体験。",
    clientAddr: CLIENT, serverAddr: { ip: "93.184.216.34", port: 443 },
    ops: [
      { type: "socket_create", side: "client" },
      { type: "socket_create", side: "server" },
      { type: "bind", side: "server", port: 443 },
      { type: "listen", side: "server" },
      { type: "connect", side: "client" },
      { type: "accept", side: "server" },
      { type: "http_request", request: httpReq("GET", "/", { "Accept": "*/*", "Accept-Encoding": "gzip" }) },
      { type: "http_response", response: httpRes(200, "OK", {
        "Content-Type": "text/html; charset=UTF-8", "Content-Length": "60", "Server": "nginx/1.25",
      }, "<html><head><title>Example</title></head><body>OK</body></html>") },
      { type: "close", side: "client" },
    ],
  },
];
