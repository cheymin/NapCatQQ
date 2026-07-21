import { Button } from '@heroui/button';
import { CardBody, CardHeader } from '@heroui/card';
import { Image } from '@heroui/image';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { MdSettings } from 'react-icons/md';

import logo from '@/assets/images/logo.png';
import GUIDManager from '@/components/guid_manager';
import Modal from '@/components/modal';

import HoverEffectCard from '@/components/effect_card';
import { title } from '@/components/primitives';
import VNCLogin from '@/components/vnc_login';
import { ThemeSwitch } from '@/components/theme-switch';

import QQManager from '@/controllers/qq_manager';
import PureLayout from '@/layouts/pure';
import { motion } from 'motion/react';

export default function QQLoginPage () {
  const navigate = useNavigate();
  const [showGUIDManager, setShowGUIDManager] = useState(false);
  const firstLoad = useRef<boolean>(true);

  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const data = await QQManager.checkQQLoginStatusWithQrcode();
        if (data.isLogin) {
          toast.success('QQ登录成功');
          navigate('/', { replace: true });
        }
      } catch (_e) {
        // 忽略
      }
    }, 3000);

    return () => clearInterval(timer);
  }, [navigate]);

  return (
    <>
      <title>QQ登录 - NapCat WebUI</title>
      <PureLayout>
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, type: 'spring', stiffness: 120, damping: 20 }}
          className='w-[800px] max-w-full py-8 px-2 md:px-8 overflow-hidden'
        >
          <HoverEffectCard
            className='items-center gap-4 pt-0 pb-6 bg-default-50'
            maxXRotation={3}
            maxYRotation={3}
          >
            <CardHeader className='inline-block max-w-lg text-center justify-center'>
              <div className='flex items-center justify-center w-full gap-2 pt-10'>
                <Image alt='logo' height='7em' src={logo} />
                <div>
                  <span className={title()}>Web&nbsp;</span>
                  <span className={title({ color: 'violet' })}>
                    Login&nbsp;
                  </span>
                </div>
              </div>
              <div className='absolute right-4 top-4 flex items-center gap-2'>
                <Button isIconOnly variant='light' aria-label='Settings' onPress={() => setShowGUIDManager(true)}>
                  <MdSettings size={22} />
                </Button>
                <ThemeSwitch />
              </div>
            </CardHeader>

            <CardBody className='flex gap-5 p-10 pt-0'>
              <VNCLogin />
              <Button
                className='w-fit mx-auto'
                variant='light'
                color='primary'
                onPress={() => {
                  navigate('/web_login', {
                    replace: true,
                  });
                }}
              >
                返回 Web Login
              </Button>
            </CardBody>
          </HoverEffectCard>
        </motion.div>
      </PureLayout>
      {showGUIDManager && (
        <Modal
          title='设备 GUID 管理'
          content={<GUIDManager compact showRestart />}
          size='lg'
          hideFooter
          onClose={() => setShowGUIDManager(false)}
        />
      )}
    </>
  );
}
