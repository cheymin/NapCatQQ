import { useEffect, useRef, useState, useCallback } from 'react';
import RFB from '@novnc/novnc';
import { Button } from '@heroui/button';
import { CardBody } from '@heroui/card';
import { toast } from 'react-hot-toast';
import { motion } from 'motion/react';

export default function VNCLogin () {
  const containerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFB | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [status, setStatus] = useState('');

  const connectVNC = useCallback(async () => {
    if (!containerRef.current) return;

    setIsConnecting(true);
    setStatus('正在连接 VNC...');

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const url = `${protocol}//${host}/vnc/ws`;

      const rfb = new RFB(containerRef.current, url, {
        shared: true,
      });
      rfbRef.current = rfb;

      rfb.addEventListener('connect', () => {
        setIsConnected(true);
        setIsConnecting(false);
        setStatus('VNC 连接成功');
        toast.success('VNC 连接成功，您可以在下方窗口中完成 QQ 登录');
      });

      rfb.addEventListener('disconnect', (e: any) => {
        setIsConnected(false);
        setIsConnecting(false);
        if (e.detail.clean) {
          setStatus('VNC 连接已断开');
        } else {
          setStatus('VNC 连接异常断开');
          toast.error('VNC 连接异常断开，请检查服务状态');
        }
      });

      rfb.addEventListener('error', () => {
        setIsConnected(false);
        setIsConnecting(false);
        setStatus('VNC 连接失败');
        toast.error('VNC 连接失败，请检查服务状态');
      });

      rfb.addEventListener('status', (e: any) => {
        setStatus(e.detail.text);
      });
    } catch (error) {
      setIsConnecting(false);
      setStatus('连接失败');
      toast.error(`VNC 连接异常: ${(error as Error).message}`);
    }
  }, []);

  const disconnectVNC = useCallback(() => {
    if (rfbRef.current) {
      rfbRef.current.disconnect();
      rfbRef.current = null;
    }
    setIsConnected(false);
    setStatus('已断开连接');
  }, []);

  useEffect(() => {
    connectVNC();

    return () => {
      disconnectVNC();
    };
  }, [connectVNC, disconnectVNC]);

  return (
    <CardBody className='flex flex-col gap-4 p-4'>
      <div className='flex items-center justify-between'>
        <div className='text-sm text-muted-foreground'>
          {status}
        </div>
        <div className='flex gap-2'>
          {isConnected ? (
            <Button
              variant='bordered'
              size='sm'
              onClick={disconnectVNC}
            >
              断开连接
            </Button>
          ) : (
            <Button
              variant='bordered'
              size='sm'
              onClick={connectVNC}
              isDisabled={isConnecting}
            >
              {isConnecting ? '连接中...' : '重新连接'}
            </Button>
          )}
        </div>
      </div>

      <motion.div
        ref={containerRef}
        className='relative w-full h-[480px] bg-black rounded-lg overflow-hidden border border-border'
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        {!isConnected && !isConnecting && (
          <div className='absolute inset-0 flex items-center justify-center text-white/50'>
            <div className='text-center'>
              <div className='text-4xl mb-2'>🖥️</div>
              <div className='text-lg'>等待 VNC 连接...</div>
              <div className='text-sm mt-1'>请确保服务端已启动 VNC 服务</div>
            </div>
          </div>
        )}
        {isConnecting && (
          <div className='absolute inset-0 flex items-center justify-center text-white'>
            <div className='text-center'>
              <div className='w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-2' />
              <div>正在连接 VNC 服务...</div>
            </div>
          </div>
        )}
      </motion.div>

      <div className='text-xs text-muted-foreground text-center'>
        提示：在上方窗口中完成 QQ 登录后，刷新页面或等待自动跳转
      </div>
    </CardBody>
  );
}
