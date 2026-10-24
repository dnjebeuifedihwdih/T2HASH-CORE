package main

import (
	"log"
	"net"
	"sync"
	"time"

	"github.com/xtaci/smux"
)

/**
 * Reverse Tunnel Engine for National Intranet (اینترنت ملی), Whitelisted IPs (آی‌پی اکسس‌شده),
 * and Restricted VPSs with No International Outbound Internet (سرور بدون اینترنت).
 *
 * Architecture:
 * 1. Reverse Hub (Receiver / Client Front):
 *    - Listens on `controlListen` for the outbound bridge connection from the peer.
 *    - Listens on `clientListen` for incoming user/VPN connections (e.g. 9005 / 9006).
 *    - As user connections arrive, multiplexes each TCP stream through the reverse control session.
 *
 * 2. Reverse Bridge (Bridge Connector / Target Forwarder):
 *    - Initiates outbound connection to `remoteControl` using TLS mimicry & national SNI bypass.
 *    - Accepts incoming streams from the Reverse Hub and pipes them directly to `target` (e.g. Xray 2505/2506).
 *    - Includes automatic keep-alive, heartbeat, and reconnection with exponential backoff.
 */

func runReverseHub(controlListen, clientListen, sni string) {
	controlLn, err := NewTLSListener(controlListen, sni)
	if err != nil {
		log.Fatalf("[!] [REVERSE HUB] Failed to bind TLS control listener on %s: %v", controlListen, err)
	}
	defer controlLn.Close()

	clientLn, err := net.Listen("tcp", clientListen)
	if err != nil {
		log.Fatalf("[!] [REVERSE HUB] Failed to bind client listener on %s: %v", clientListen, err)
	}
	defer clientLn.Close()

	log.Printf("[+] [REVERSE HUB] Control Listener ready on %s (SNI: %s)", controlListen, sni)
	log.Printf("[+] [REVERSE HUB] Client Entry Listener active on %s (Ready for users)", clientListen)

	var (
		activeSession *smux.Session
		sessionMu     sync.RWMutex
	)

	// Accept bridge connections in background
	go func() {
		for {
			conn, err := controlLn.Accept()
			if err != nil {
				log.Printf("[!] [REVERSE HUB] Control accept error: %v", err)
				time.Sleep(1 * time.Second)
				continue
			}

			log.Printf("[+] [REVERSE HUB] Incoming Reverse Bridge connected from %s", conn.RemoteAddr())
			obfsed := WrapObfs(conn, DefaultObfsConfig())
			sess, err := smux.Client(obfsed, smuxConfig())
			if err != nil {
				log.Printf("[!] [REVERSE HUB] smux initialization error: %v", err)
				conn.Close()
				continue
			}

			sessionMu.Lock()
			if activeSession != nil && !activeSession.IsClosed() {
				activeSession.Close()
			}
			activeSession = sess
			sessionMu.Unlock()
			log.Printf("[+] [REVERSE HUB] Reverse multiplexed session is now ACTIVE and ARMED.")
		}
	}()

	// Accept incoming client connections (V2Ray / users)
	for {
		clientConn, err := clientLn.Accept()
		if err != nil {
			log.Printf("[!] [REVERSE HUB] Client accept error: %v", err)
			continue
		}

		go func(c net.Conn) {
			defer c.Close()

			sessionMu.RLock()
			sess := activeSession
			sessionMu.RUnlock()

			if sess == nil || sess.IsClosed() {
				log.Printf("[!] [REVERSE HUB] Client arrived on %s, but Reverse Bridge is not yet connected!", clientListen)
				return
			}

			stream, err := sess.OpenStream()
			if err != nil {
				log.Printf("[!] [REVERSE HUB] Failed to open stream on reverse bridge: %v", err)
				return
			}
			defer stream.Close()

			pipe(c, stream)
		}(clientConn)
	}
}

func runReverseBridge(remoteControl, target, sni string) {
	log.Printf("[+] [REVERSE BRIDGE] Starting Reverse Bridge toward Control: %s", remoteControl)
	log.Printf("[+] [REVERSE BRIDGE] Forwarding reverse streams to local target: %s", target)
	log.Printf("    SNI: %s (National Intranet / Whitelist Camouflage)", sni)

	backoff := 2 * time.Second

	for {
		log.Printf("[*] [REVERSE BRIDGE] Connecting to %s ...", remoteControl)
		conn, err := dialTLS(remoteControl, sni)
		if err != nil {
			log.Printf("[!] [REVERSE BRIDGE] Connection to %s failed: %v. Retrying in %v...", remoteControl, err, backoff)
			time.Sleep(backoff)
			if backoff < 15*time.Second {
				backoff += 2 * time.Second
			}
			continue
		}

		backoff = 2 * time.Second
		log.Printf("[+] [REVERSE BRIDGE] Successfully connected to %s. Initializing server-side smux listener...", remoteControl)

		obfsed := WrapObfs(conn, DefaultObfsConfig())
		sess, err := smux.Server(obfsed, smuxConfig())
		if err != nil {
			log.Printf("[!] [REVERSE BRIDGE] smux.Server initialization failed: %v", err)
			conn.Close()
			time.Sleep(3 * time.Second)
			continue
		}

		// Accept streams from reverse hub
		for {
			stream, err := sess.AcceptStream()
			if err != nil {
				log.Printf("[!] [REVERSE BRIDGE] Session closed or stream accept error: %v", err)
				break
			}

			go func(s *smux.Stream) {
				defer s.Close()
				out, err := dialTCP(target)
				if err != nil {
					log.Printf("[!] [REVERSE BRIDGE] Failed to dial local target %s: %v", target, err)
					return
				}
				defer out.Close()
				pipe(s, out)
			}(stream)
		}

		sess.Close()
		conn.Close()
		log.Printf("[*] [REVERSE BRIDGE] Connection dropped. Re-establishing reverse bridge in 3s...")
		time.Sleep(3 * time.Second)
	}
}
